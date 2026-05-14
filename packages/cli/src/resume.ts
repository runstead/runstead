import type { Task, ToolCall, WorkerRun } from "@runstead/core";
import { createRunsteadId, type JsonObject, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { withRunsteadManagerLock } from "./manager-lock.js";
import { finishToolCall, finishWorkerRun } from "./runtime-audit.js";
import { listTasks } from "./tasks.js";

export interface InterruptedTask {
  task: Task;
  reason: "claimed_or_running";
}

export interface FindInterruptedTasksOptions {
  cwd?: string;
}

export interface FindInterruptedTasksResult {
  interruptedTasks: InterruptedTask[];
  stateDb: string;
}

export interface ResumeInterruptedTasksOptions {
  cwd?: string;
  now?: Date;
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

export function findInterruptedTasks(
  options: FindInterruptedTasksOptions = {}
): FindInterruptedTasksResult {
  const tasks = listTasks(options);

  return {
    interruptedTasks: tasks.tasks
      .filter((task) => INTERRUPTED_STATUSES.has(task.status))
      .map((task) => ({
        task,
        reason: "claimed_or_running"
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

      const task: Task = {
        ...interrupted.task,
        status: "queued",
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
