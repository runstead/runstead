import {
  createRunsteadId,
  type JsonObject,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import { appendEventAndProject, type RunsteadDatabase } from "@runstead/state-sqlite";

export function finalizeVerifierTask(input: {
  runningTask: Task;
  status: Task["status"];
  output: JsonObject;
  updatedAt: string;
  database: RunsteadDatabase;
  projectTaskState: boolean;
}): Task {
  const finalTask: Task = {
    ...input.runningTask,
    status: input.status,
    output: input.output,
    updatedAt: input.updatedAt
  };

  if (input.projectTaskState) {
    appendEventAndProject(input.database, {
      event: verifierTaskEvent(
        `task.${input.status}`,
        finalTask,
        finalTask.output ?? {},
        input.updatedAt
      ),
      projection: {
        type: "task",
        value: finalTask
      }
    });
  }

  return finalTask;
}

export function verifierTaskEvent(
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
