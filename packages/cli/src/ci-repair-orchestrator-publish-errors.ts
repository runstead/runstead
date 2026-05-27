import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import {
  ciRepairApprovalSummary,
  ciRepairPublishApprovalStage
} from "./ci-repair-orchestrator-approval.js";
import {
  incrementCiRepairCounter,
  type CiRepairOrchestratorResumeContext
} from "./ci-repair-orchestrator-context.js";
import { markTaskTerminal } from "./ci-repair-orchestrator-task-state.js";
import type {
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "./governed-action.js";
import { finishWorkerRun } from "./runtime-audit.js";

export function waitForCiRepairPublishApproval(input: {
  database: RunsteadDatabase;
  task: Task;
  workerRun: WorkerRun;
  context: CiRepairOrchestratorResumeContext;
  error: ToolActionApprovalRequiredError;
  now?: Date;
}) {
  const approvalStage = ciRepairPublishApprovalStage(input.error.toolCall.actionType);
  const waitingContext = {
    ...input.context,
    counters: incrementCiRepairCounter(input.context, "approvalRound")
  };
  const waitingTask = markTaskTerminal({
    database: input.database,
    task: input.task,
    status: "waiting_approval",
    output: {
      ...(input.task.output ?? {}),
      ciRepairOrchestrator: {
        ...waitingContext,
        stage: approvalStage,
        approvalId: input.error.approval.id
      }
    },
    ...(input.now === undefined ? {} : { now: input.now })
  });

  finishWorkerRun({
    database: input.database,
    workerRun: input.workerRun,
    status: "waiting_approval",
    output: {
      approvalId: input.error.approval.id,
      actionType: input.error.toolCall.actionType
    },
    ...(input.now === undefined ? {} : { now: input.now })
  });

  return {
    status: "waiting_approval" as const,
    task: waitingTask,
    context: waitingContext,
    approval: ciRepairApprovalSummary(input.error)
  };
}

export function markCiRepairPublishDenied(input: {
  database: RunsteadDatabase;
  task: Task;
  workerRun: WorkerRun;
  error: ToolActionDeniedError;
  now?: Date;
}): void {
  markTaskTerminal({
    database: input.database,
    task: input.task,
    status: "blocked",
    output: {
      summary: input.error.message,
      policyDecisionId: input.error.policyDecision.id
    },
    ...(input.now === undefined ? {} : { now: input.now })
  });
  finishWorkerRun({
    database: input.database,
    workerRun: input.workerRun,
    status: "blocked",
    output: {
      error: input.error.message,
      policyDecisionId: input.error.policyDecision.id
    },
    ...(input.now === undefined ? {} : { now: input.now })
  });
}
