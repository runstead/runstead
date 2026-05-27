import type { Task } from "@runstead/core";
import { appendEventAndProject, type RunsteadDatabase } from "@runstead/state-sqlite";

import { verifierTaskEvent } from "./verifier-runner-task-state.js";

export function projectVerifierTaskStarted(input: {
  database: RunsteadDatabase;
  task: Task;
  createdAt: string;
  projectTaskState: boolean;
}): void {
  if (!input.projectTaskState) {
    return;
  }

  appendEventAndProject(input.database, {
    event: verifierTaskEvent(
      "task.started",
      input.task,
      { attempt: input.task.attempt },
      input.createdAt
    ),
    projection: {
      type: "task",
      value: input.task
    }
  });
}

export function createVerifierExecutionAttemptStarter(input: {
  database: RunsteadDatabase;
  task: Task;
  previousAttempt: number;
  createdAt: string;
  projectTaskState: boolean;
}): () => Task {
  let currentTask = input.task;
  let executionAttemptStarted = false;

  return () => {
    if (executionAttemptStarted) {
      return currentTask;
    }

    executionAttemptStarted = true;
    currentTask = {
      ...currentTask,
      attempt: currentTask.attempt + 1,
      updatedAt: input.createdAt
    };

    if (input.projectTaskState) {
      appendEventAndProject(input.database, {
        event: verifierTaskEvent(
          "task.execution_started",
          currentTask,
          {
            previousAttempt: input.previousAttempt,
            attempt: currentTask.attempt
          },
          input.createdAt
        ),
        projection: {
          type: "task",
          value: currentTask
        }
      });
    }

    return currentTask;
  };
}
