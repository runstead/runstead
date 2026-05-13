import type { Task } from "@runstead/core";
import { createRunsteadId, type JsonObject, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

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

export interface ResumeInterruptedTasksResult {
  requeuedTasks: RequeuedTask[];
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
): ResumeInterruptedTasksResult {
  const detected = findInterruptedTasks(options);
  const database = openRunsteadDatabase(detected.stateDb);
  const requeuedAt = (options.now ?? new Date()).toISOString();
  const requeuedTasks: RequeuedTask[] = [];

  try {
    for (const interrupted of detected.interruptedTasks) {
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
    stateDb: detected.stateDb
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
