import {
  createRunsteadId,
  type JsonObject,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import { appendEventAndProject, type RunsteadDatabase } from "@runstead/state-sqlite";

export function markCiRepairTaskTerminal(input: {
  database: RunsteadDatabase;
  task: Task;
  status: "cancelled" | "failed";
  error: unknown;
  now?: Date;
}): Task {
  const updatedAt = (input.now ?? new Date()).toISOString();
  const output: JsonObject = {
    error: errorMessage(input.error)
  };
  const task: Task = {
    ...input.task,
    status: input.status,
    output,
    updatedAt
  };

  appendEventAndProject(input.database, {
    event: ciRepairTaskEvent(`task.${input.status}`, task, output, updatedAt),
    projection: {
      type: "task",
      value: task
    }
  });

  return task;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ciRepairTaskEvent(
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
