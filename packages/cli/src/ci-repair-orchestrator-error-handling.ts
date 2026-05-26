import type { Task, WorkerRun } from "@runstead/core";
import type { openRunsteadDatabase } from "@runstead/state-sqlite";

import {
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "./governed-action.js";
import {
  ciRepairApprovalRecord,
  ciRepairApprovalSummary
} from "./ci-repair-orchestrator-approval.js";
import type { CreateCiRepairTaskFromWorkflowRunResult } from "./ci-repair.js";
import type {
  CiRepairWorkerResult,
  RunCiRepairOrchestratorResult
} from "./ci-repair-orchestrator-types.js";
import {
  incrementCiRepairCounter,
  type CiRepairOrchestratorStageContext
} from "./ci-repair-orchestrator-context.js";
import {
  isStagePersistenceInterruption,
  markTaskTerminal
} from "./ci-repair-orchestrator-task-state.js";
import { finishWorkerRun } from "./runtime-audit.js";

export interface HandleCiRepairOrchestratorErrorInput {
  error: unknown;
  database: ReturnType<typeof openRunsteadDatabase>;
  task: Task;
  workerRun: WorkerRun;
  context: CiRepairOrchestratorStageContext;
  ciRepair: CreateCiRepairTaskFromWorkflowRunResult;
  branchName: string;
  completedWorkerResult?: CiRepairWorkerResult;
  now?: Date;
}

export function handleCiRepairOrchestratorError(
  input: HandleCiRepairOrchestratorErrorInput
): RunCiRepairOrchestratorResult | undefined {
  if (isStagePersistenceInterruption(input.error)) {
    throw input.error;
  }

  if (input.error instanceof ToolActionApprovalRequiredError) {
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
        summary: `${input.error.toolCall.actionType} requires approval`,
        ciRepairOrchestrator: {
          ...waitingContext,
          approvalId: input.error.approval.id
        },
        approval: ciRepairApprovalRecord(input.error)
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
      status: "waiting_approval",
      ciRepair: {
        ...input.ciRepair,
        task: waitingTask
      },
      branchName: input.branchName,
      ...(input.completedWorkerResult === undefined
        ? {}
        : { workerResult: input.completedWorkerResult }),
      approval: ciRepairApprovalSummary(input.error)
    };
  }

  if (input.error instanceof ToolActionDeniedError) {
    markTaskTerminal({
      database: input.database,
      task: input.task,
      status: "blocked",
      output: {
        ...(input.task.output ?? {}),
        summary: input.error.message,
        ciRepairOrchestrator: {
          ...input.context,
          stage: "blocked"
        },
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

  return undefined;
}
