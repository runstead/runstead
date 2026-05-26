import type { JsonObject, Task } from "@runstead/core";
import { appendEventAndProject, type RunsteadDatabase } from "@runstead/state-sqlite";

import { localAgentEvent } from "./local-agent-actions.js";
import { LOCAL_AGENT_TASK_TYPE } from "./local-agent-types.js";

export function isLocalAgentTask(task: Task): boolean {
  return task.domain === "repo-maintenance" && task.type === LOCAL_AGENT_TASK_TYPE;
}

export function finalizeLocalAgentTask(input: {
  database: RunsteadDatabase;
  task: Task;
  status: Task["status"];
  output: JsonObject;
  now?: Date;
}): Task {
  const updatedAt = (input.now ?? new Date()).toISOString();
  const task: Task = {
    ...input.task,
    status: input.status,
    output: input.output,
    updatedAt
  };

  appendEventAndProject(input.database, {
    event: localAgentEvent(`task.${input.status}`, "task", task.id, updatedAt, {
      previousStatus: input.task.status,
      ...input.output
    }),
    projection: {
      type: "task",
      value: task
    }
  });

  return task;
}
