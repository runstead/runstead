import type { Task, ToolCall, WorkerRun } from "@runstead/core";
import { createRunsteadId, type JsonObject, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { withRunsteadManagerLock } from "./manager-lock.js";
import { finishToolCall, finishWorkerRun } from "./runtime-audit.js";
import { listTasks } from "./tasks.js";

export interface InterruptedTask {
  task: Task;
  reason: "claimed_or_running" | "stale_lease";
}

export interface FindInterruptedTasksOptions {
  cwd?: string;
  now?: Date;
  onlyStale?: boolean;
  staleAfterMs?: number;
}

export interface FindInterruptedTasksResult {
  interruptedTasks: InterruptedTask[];
  stateDb: string;
}

export interface ResumeInterruptedTasksOptions {
  cwd?: string;
  now?: Date;
  onlyStale?: boolean;
  staleAfterMs?: number;
}

export interface RequeuedTask {
  task: Task;
  event: RunsteadEvent;
  previousStatus: Task["status"];
}

export interface ResumeFailedTask {
  task: Task;
  event: RunsteadEvent;
  previousStatus: Task["status"];
}

export interface ResumeInterruptedTasksResult {
  requeuedTasks: RequeuedTask[];
  failedTasks: ResumeFailedTask[];
  stateDb: string;
}

const INTERRUPTED_STATUSES = new Set<Task["status"]>(["claimed", "running"]);
const DEFAULT_STALE_LEASE_FALLBACK_MS = 30 * 60 * 1000;

export function findInterruptedTasks(
  options: FindInterruptedTasksOptions = {}
): FindInterruptedTasksResult {
  const tasks = listTasks(options);
  const staleIds =
    options.onlyStale === true
      ? staleInterruptedTaskIds({
          stateDb: tasks.stateDb,
          now: options.now ?? new Date(),
          staleAfterMs: options.staleAfterMs ?? DEFAULT_STALE_LEASE_FALLBACK_MS
        })
      : undefined;

  return {
    interruptedTasks: tasks.tasks
      .filter((task) => INTERRUPTED_STATUSES.has(task.status))
      .filter((task) => staleIds === undefined || staleIds.has(task.id))
      .map((task) => ({
        task,
        reason: staleIds === undefined ? "claimed_or_running" : "stale_lease"
      })),
    stateDb: tasks.stateDb
  };
}

export function resumeInterruptedTasks(
  options: ResumeInterruptedTasksOptions = {}
): Promise<ResumeInterruptedTasksResult> {
  return withRunsteadManagerLock(options, () =>
    resumeInterruptedTasksUnlocked(options)
  );
}

export function recoverStaleRunningTasks(
  options: ResumeInterruptedTasksOptions = {}
): Promise<ResumeInterruptedTasksResult> {
  return resumeInterruptedTasks({
    ...options,
    onlyStale: true
  });
}

function resumeInterruptedTasksUnlocked(
  options: ResumeInterruptedTasksOptions = {}
): ResumeInterruptedTasksResult {
  const detected = findInterruptedTasks(options);
  const database = openRunsteadDatabase(detected.stateDb);
  const resumedAt = options.now ?? new Date();
  const requeuedAt = resumedAt.toISOString();
  const requeuedTasks: RequeuedTask[] = [];
  const failedTasks: ResumeFailedTask[] = [];

  try {
    for (const interrupted of detected.interruptedTasks) {
      failRunningWorkerRuns({
        database,
        task: interrupted.task,
        now: resumedAt
      });
      failInterruptedToolCalls({
        database,
        task: interrupted.task,
        now: resumedAt
      });

      if (interrupted.task.attempt >= interrupted.task.maxAttempts) {
        const task: Task = {
          ...interrupted.task,
          status: "failed",
          output: resumeFailedOutput(interrupted.task),
          updatedAt: requeuedAt
        };
        const event = taskEvent("task.failed", task, task.output ?? {}, requeuedAt);

        appendEventAndProject(database, {
          event,
          projection: {
            type: "task",
            value: task
          }
        });
        failedTasks.push({
          task,
          event,
          previousStatus: interrupted.task.status
        });
        continue;
      }

      const output = resumeRequeuedOutput(interrupted.task);
      const task: Task = {
        ...interrupted.task,
        status: "queued",
        ...(output === undefined ? {} : { output }),
        updatedAt: requeuedAt
      };
      const event = taskEvent(
        "task.requeued",
        task,
        {
          previousStatus: interrupted.task.status,
          reason: interrupted.reason
        },
        requeuedAt
      );

      appendEventAndProject(database, {
        event,
        projection: {
          type: "task",
          value: task
        }
      });
      requeuedTasks.push({
        task,
        event,
        previousStatus: interrupted.task.status
      });
    }
  } finally {
    database.close();
  }

  return {
    requeuedTasks,
    failedTasks,
    stateDb: detected.stateDb
  };
}

function staleInterruptedTaskIds(input: {
  stateDb: string;
  now: Date;
  staleAfterMs: number;
}): Set<string> {
  const database = openRunsteadDatabase(input.stateDb);
  const nowIso = input.now.toISOString();
  const fallbackCutoff = new Date(input.now.getTime() - input.staleAfterMs)
    .toISOString();

  try {
    const rows = database
      .prepare(
        `
        SELECT id, owner_id, lease_expires_at, updated_at
        FROM tasks
        WHERE status IN ('claimed', 'running')
          AND (
            (lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
            OR (lease_expires_at IS NULL AND updated_at <= ?)
          )
        ORDER BY updated_at ASC, id ASC
      `
      )
      .all(nowIso, fallbackCutoff) as unknown as StaleTaskLeaseRow[];

    return new Set(
      rows
        .filter((row) => !leaseOwnerAlive(row.owner_id))
        .map((row) => row.id)
    );
  } finally {
    database.close();
  }
}

interface StaleTaskLeaseRow {
  id: string;
  owner_id: string | null;
  lease_expires_at: string | null;
  updated_at: string;
}

function leaseOwnerAlive(ownerId: string | null): boolean {
  if (ownerId === null) {
    return false;
  }

  const match = /^pid:(\d+)$/.exec(ownerId);

  if (match === null) {
    return false;
  }

  const pid = Number.parseInt(match[1] ?? "", 10);

  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isPermissionDeniedSignalError(error);
  }
}

function isPermissionDeniedSignalError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EPERM"
  );
}

function failInterruptedToolCalls(input: {
  database: ReturnType<typeof openRunsteadDatabase>;
  task: Task;
  now: Date;
}): ToolCall[] {
  const interruptedToolCalls = (
    input.database
      .prepare(
        `
        SELECT id, worker_run_id, task_id, action_type, status,
               policy_decision_id, input_json, output_json, started_at, ended_at
        FROM tool_calls
        WHERE task_id = ? AND status IN ('requested', 'allowed', 'running')
        ORDER BY started_at ASC, id ASC
      `
      )
      .all(input.task.id) as unknown as ToolCallRow[]
  ).map(rowToToolCall);

  return interruptedToolCalls.map((toolCall) =>
    finishToolCall({
      database: input.database,
      toolCall,
      status: "failed",
      ...(toolCall.policyDecisionId === undefined
        ? {}
        : { policyDecisionId: toolCall.policyDecisionId }),
      output: {
        ...(toolCall.output ?? {}),
        summary: "Tool call interrupted during resume",
        previousTaskStatus: input.task.status
      },
      now: input.now
    })
  );
}

function resumeFailedOutput(task: Task): JsonObject {
  return {
    ...(task.output ?? {}),
    summary: "Max attempts reached during resume",
    previousStatus: task.status,
    attempt: task.attempt,
    maxAttempts: task.maxAttempts
  };
}

function resumeRequeuedOutput(task: Task): JsonObject | undefined {
  const output = task.output;

  if (output === undefined) {
    return undefined;
  }

  const context = output.ciRepairOrchestrator;

  if (!isRecord(context)) {
    return output;
  }

  const counters = isRecord(context.counters) ? context.counters : {};

  return {
    ...output,
    ciRepairOrchestrator: {
      ...context,
      counters: {
        ...counters,
        resumeCount: numberOrZero(counters.resumeCount) + 1
      }
    }
  };
}

function failRunningWorkerRuns(input: {
  database: ReturnType<typeof openRunsteadDatabase>;
  task: Task;
  now: Date;
}): WorkerRun[] {
  const runningWorkerRuns = (
    input.database
      .prepare(
        `
        SELECT id, task_id, worker_type, status, enforcement_level,
               checkpoint_before, started_at, ended_at, output_json
        FROM worker_runs
        WHERE task_id = ? AND status = 'running'
        ORDER BY started_at ASC, id ASC
      `
      )
      .all(input.task.id) as unknown as WorkerRunRow[]
  ).map(rowToWorkerRun);

  return runningWorkerRuns.map((workerRun) =>
    finishWorkerRun({
      database: input.database,
      workerRun,
      status: "failed",
      output: {
        ...(workerRun.output ?? {}),
        summary: "Worker run interrupted during resume",
        previousTaskStatus: input.task.status
      },
      now: input.now
    })
  );
}

interface WorkerRunRow {
  id: string;
  task_id: string;
  worker_type: string;
  status: WorkerRun["status"];
  enforcement_level: string;
  checkpoint_before: string | null;
  started_at: string;
  ended_at: string | null;
  output_json: string | null;
}

interface ToolCallRow {
  id: string;
  worker_run_id: string;
  task_id: string;
  action_type: string;
  status: ToolCall["status"];
  policy_decision_id: string | null;
  input_json: string;
  output_json: string | null;
  started_at: string;
  ended_at: string | null;
}

function rowToWorkerRun(row: WorkerRunRow): WorkerRun {
  return {
    id: row.id,
    taskId: row.task_id,
    workerType: row.worker_type,
    status: row.status,
    enforcementLevel: row.enforcement_level,
    ...(row.checkpoint_before === null
      ? {}
      : { checkpointBefore: row.checkpoint_before }),
    startedAt: row.started_at,
    ...(row.ended_at === null ? {} : { endedAt: row.ended_at }),
    ...(row.output_json === null
      ? {}
      : { output: JSON.parse(row.output_json) as JsonObject })
  };
}

function rowToToolCall(row: ToolCallRow): ToolCall {
  return {
    id: row.id,
    workerRunId: row.worker_run_id,
    taskId: row.task_id,
    actionType: row.action_type,
    status: row.status,
    ...(row.policy_decision_id === null
      ? {}
      : { policyDecisionId: row.policy_decision_id }),
    input: JSON.parse(row.input_json) as JsonObject,
    ...(row.output_json === null
      ? {}
      : { output: JSON.parse(row.output_json) as JsonObject }),
    startedAt: row.started_at,
    ...(row.ended_at === null ? {} : { endedAt: row.ended_at })
  };
}

function taskEvent(
  type: string,
  task: Task,
  payload: JsonObject,
  createdAt: string
): RunsteadEvent {
  return {
    eventId: createRunsteadId("evt"),
    type,
    aggregateType: "task",
    aggregateId: task.id,
    payload,
    createdAt
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
