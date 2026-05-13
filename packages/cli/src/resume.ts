import type { Task } from "@runstead/core";
import { createRunsteadId, type JsonObject, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { withRunsteadManagerLock } from "./manager-lock.js";
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
  const requeuedAt = (options.now ?? new Date()).toISOString();
  const requeuedTasks: RequeuedTask[] = [];
  const failedTasks: ResumeFailedTask[] = [];

  try {
    for (const interrupted of detected.interruptedTasks) {
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

function resumeFailedOutput(task: Task): JsonObject {
  return {
    ...(task.output ?? {}),
    summary: "Max attempts reached during resume",
    previousStatus: task.status,
    attempt: task.attempt,
    maxAttempts: task.maxAttempts
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
