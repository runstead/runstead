import type { Task } from "@runstead/core";

import {
  type CiRepairOrchestratorCounterName,
  type CiRepairOrchestratorCounters,
  type CiRepairOrchestratorResumeContext,
  type CiRepairOrchestratorStageContext
} from "./ci-repair-orchestrator-context-types.js";
import {
  ciRepairProgressStageAtLeast,
  type CiRepairOrchestratorProgressStage
} from "./ci-repair-orchestrator-stage.js";

export {
  buildInitialCiRepairStageContext,
  buildPullRequestResumeContext
} from "./ci-repair-orchestrator-context-builders.js";
export {
  publishCoverageFromContext,
  publishCoverageStagePatch
} from "./ci-repair-orchestrator-publish-coverage.js";
export type {
  CiRepairOrchestratorCounterName,
  CiRepairOrchestratorCounters,
  CiRepairOrchestratorResumeContext,
  CiRepairOrchestratorStageContext,
  EvidenceSummary,
  PublishCoverage
} from "./ci-repair-orchestrator-context-types.js";

export function ciRepairStageContext(
  task: Task
): CiRepairOrchestratorStageContext | undefined {
  const value = task.output?.ciRepairOrchestrator;

  if (
    !isRecord(value) ||
    typeof value.stage !== "string" ||
    typeof value.runId !== "string"
  ) {
    return undefined;
  }

  return value as unknown as CiRepairOrchestratorStageContext;
}

export function incrementCiRepairCounter(
  context: CiRepairOrchestratorStageContext,
  counter: CiRepairOrchestratorCounterName
): CiRepairOrchestratorCounters {
  const counters = ciRepairCounters(context);

  return {
    ...counters,
    [counter]: counters[counter] + 1
  };
}

export function ciRepairCounters(
  context: CiRepairOrchestratorStageContext
): CiRepairOrchestratorCounters {
  const counters = context.counters;

  return {
    orchestratorAttempt: numberOrZero(counters?.orchestratorAttempt),
    workerAttempt: numberOrZero(counters?.workerAttempt),
    publishAttempt: numberOrZero(counters?.publishAttempt),
    resumeCount: numberOrZero(counters?.resumeCount),
    approvalRound: numberOrZero(counters?.approvalRound)
  };
}

export function stageAtLeast(
  stage: string,
  target: CiRepairOrchestratorProgressStage
): boolean {
  return ciRepairProgressStageAtLeast(stage, target);
}

export function parsePullRequestResumeContext(
  task: Task
): CiRepairOrchestratorResumeContext {
  const context = pullRequestResumeContext(task);

  if (context === undefined) {
    throw new Error(`Task ${task.id} is not ready to resume PR creation`);
  }

  return context;
}

export function pullRequestResumeContext(
  task: Task
): CiRepairOrchestratorResumeContext | undefined {
  const value = ciRepairOrchestratorContext(task);

  if (
    value?.stage !== "publish_approval_requested" &&
    value?.stage !== "publish_approved" &&
    value?.stage !== "push_approval_requested" &&
    value?.stage !== "branch_pushed" &&
    value?.stage !== "pr_approval_requested"
  ) {
    return undefined;
  }

  return value;
}

export function ciRepairOrchestratorContext(
  task: Task
): CiRepairOrchestratorResumeContext | undefined {
  const value = task.output?.ciRepairOrchestrator;

  if (!isRecord(value)) {
    return undefined;
  }

  if (
    typeof value.stage !== "string" ||
    typeof value.runId !== "string" ||
    typeof value.branchName !== "string" ||
    typeof value.base !== "string" ||
    typeof value.publishActionId !== "string" ||
    typeof value.pushActionId !== "string" ||
    typeof value.branchPushed !== "boolean" ||
    typeof value.prActionId !== "string" ||
    typeof value.draft !== "boolean" ||
    !isRecord(value.workflowRun) ||
    !isRecord(value.evidence) ||
    !isRecord(value.verifierTask) ||
    !Array.isArray(value.verifierCommandResults) ||
    !isRecord(value.workerResult) ||
    !isRecord(value.diffScope)
  ) {
    return undefined;
  }

  return value as unknown as CiRepairOrchestratorResumeContext;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
