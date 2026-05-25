import {
  createRunsteadId,
  type JsonObject,
  type RunsteadEvent,
  type Task,
  type WorkerRun
} from "@runstead/core";
import { appendEventAndProject, type RunsteadDatabase } from "@runstead/state-sqlite";

import { finishWorkerRun } from "./runtime-audit.js";

export function markTaskTerminal(input: {
  database: RunsteadDatabase;
  task: Task;
  status: Task["status"];
  output: JsonObject;
  now?: Date;
}): Task {
  return writeTaskOutput({
    database: input.database,
    task: input.task,
    status: input.status,
    output: input.output,
    eventType: `task.${input.status}`,
    ...(input.now === undefined ? {} : { now: input.now })
  });
}

export function writeTaskOutput(input: {
  database: RunsteadDatabase;
  task: Task;
  status?: Task["status"];
  output: JsonObject;
  eventType: string;
  now?: Date;
}): Task {
  const updatedAt = (input.now ?? new Date()).toISOString();
  const task: Task = {
    ...input.task,
    ...(input.status === undefined ? {} : { status: input.status }),
    output: input.output,
    updatedAt
  };

  appendEventAndProject(input.database, {
    event: taskEvent(input.eventType, task, input.output, updatedAt),
    projection: {
      type: "task",
      value: task
    }
  });

  return task;
}

export function failCiRepairOrchestratorRun(input: {
  database: RunsteadDatabase;
  task: Task;
  workerRun: WorkerRun;
  summary: string;
  error: unknown;
  now?: Date;
}): Task {
  const output = {
    ...(input.task.output ?? {}),
    summary: input.summary,
    error: errorMessage(input.error)
  };
  const task = markTaskTerminal({
    database: input.database,
    task: input.task,
    status: "failed",
    output,
    ...(input.now === undefined ? {} : { now: input.now })
  });

  finishWorkerRun({
    database: input.database,
    workerRun: input.workerRun,
    status: "failed",
    output,
    ...(input.now === undefined ? {} : { now: input.now })
  });

  return task;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isStagePersistenceInterruption(error: unknown): boolean {
  return (
    error instanceof Error && error.name === "RunsteadStagePersistenceInterruption"
  );
}

export function taskEvent(
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
