import type { Task } from "@runstead/core";
import { createRunsteadId, type JsonObject, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { withRunsteadManagerLock } from "./manager-lock.js";
import {
  DEFAULT_STALE_LEASE_FALLBACK_MS,
  staleInterruptedTaskIds
} from "./resume-stale-leases.js";
import {
  failInterruptedToolCalls,
  failRunningWorkerRuns
} from "./resume-runtime-audit.js";
import { listTasks } from "./tasks.js";

export interface InterruptedTask {
  task: Task;
  reason: "claimed_or_running" | "stale_lease" | "explicit_interruption";
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

const INTERRUPTED_STATUSES = new Set<Task["status"]>([
  "claimed",
  "running",
  "interrupted"
]);

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
        reason:
          task.status === "interrupted"
            ? "explicit_interruption"
            : staleIds === undefined
              ? "claimed_or_running"
              : "stale_lease"
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

      if (
        interrupted.task.attempt >= interrupted.task.maxAttempts &&
        !retryableInterruptedTask(interrupted.task)
      ) {
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
    return retryableInterruptedTask(task)
      ? {
          ...output,
          interruption: {
            ...(isRecord(output.interruption) ? output.interruption : {}),
            resumeCount:
              numberOrZero(
                isRecord(output.interruption) ? output.interruption.resumeCount : 0
              ) + 1
          }
        }
      : output;
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

function retryableInterruptedTask(task: Task): boolean {
  return task.status === "interrupted" && interruptedReason(task) === "model_timeout";
}

function interruptedReason(task: Task): string | undefined {
  const interruption = task.output?.interruption;

  return isRecord(interruption) && typeof interruption.reason === "string"
    ? interruption.reason
    : undefined;
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
