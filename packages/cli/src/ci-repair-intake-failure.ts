import type { RunsteadEvent, Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { IgnoredCiRepairTaskResult } from "./ci-repair-types.js";
import { errorMessage, markCiRepairTaskTerminal } from "./ci-repair-task-state.js";
import { NonRepairableWorkflowRunError } from "./ci-repair-workflow-run.js";
import type {
  GitHubWorkflowRunLog,
  GitHubWorkflowRunStatus
} from "./github-actions.js";
import { finishWorkerRun } from "./runtime-audit.js";

export function handleCiRepairWorkflowRunIntakeFailure(input: {
  database: RunsteadDatabase;
  cwd: string;
  stateDb: string;
  task: Task;
  taskCreatedEvent: RunsteadEvent;
  workerRun: WorkerRun;
  error: unknown;
  fetchedWorkflowRun?: GitHubWorkflowRunStatus;
  fetchedLog?: GitHubWorkflowRunLog;
  now?: Date;
}): IgnoredCiRepairTaskResult {
  const notRepairable = input.error instanceof NonRepairableWorkflowRunError;
  const terminalTask = markCiRepairTaskTerminal({
    database: input.database,
    task: input.task,
    status: notRepairable ? "cancelled" : "failed",
    error: input.error,
    ...(input.now === undefined ? {} : { now: input.now })
  });

  finishWorkerRun({
    database: input.database,
    workerRun: input.workerRun,
    status: notRepairable ? "completed" : "failed",
    output: {
      error: errorMessage(input.error),
      ...(notRepairable ? { reason: "workflow_not_repairable" } : {})
    },
    ...(input.now === undefined ? {} : { now: input.now })
  });

  if (
    notRepairable &&
    input.fetchedWorkflowRun !== undefined &&
    input.fetchedLog !== undefined
  ) {
    return {
      status: "ignored",
      reason: "workflow_not_repairable",
      taskStatus: "cancelled",
      cwd: input.cwd,
      stateDb: input.stateDb,
      task: terminalTask,
      event: input.taskCreatedEvent,
      workflowRun: input.fetchedWorkflowRun,
      log: input.fetchedLog,
      created: true,
      error: errorMessage(input.error)
    };
  }

  throw input.error;
}
