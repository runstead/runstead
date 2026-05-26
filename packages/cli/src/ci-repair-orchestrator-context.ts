import type { Task } from "@runstead/core";

import type { CreateCiRepairTaskResult } from "./ci-repair.js";
import { stableActionId } from "./ci-repair-orchestrator-actions.js";
import {
  evidenceSummary,
  type CiRepairOrchestratorCounterName,
  type CiRepairOrchestratorCounters,
  type CiRepairOrchestratorResumeContext,
  type CiRepairOrchestratorStageContext,
  type PublishCoverage
} from "./ci-repair-orchestrator-context-types.js";
import {
  ciRepairProgressStageAtLeast,
  type CiRepairOrchestratorProgressStage
} from "./ci-repair-orchestrator-stage.js";
import type {
  CiRepairWorkerKind,
  CiRepairWorkerResult
} from "./ci-repair-orchestrator-types.js";
import { durableWorkerResult } from "./ci-repair-orchestrator-worker-output.js";
import type { GitDiffScopeVerification } from "./diff-scope-verifier.js";
import type { CommitGitChangesResult } from "./git-branch.js";
import type { RunTaskVerifiersResult } from "./verifier-runner.js";

export type {
  CiRepairOrchestratorCounterName,
  CiRepairOrchestratorCounters,
  CiRepairOrchestratorResumeContext,
  CiRepairOrchestratorStageContext,
  EvidenceSummary,
  PublishCoverage
} from "./ci-repair-orchestrator-context-types.js";

export function buildInitialCiRepairStageContext(input: {
  ciRepair: CreateCiRepairTaskResult;
  branchName: string;
  base: string;
  draft: boolean;
  worker: CiRepairWorkerKind;
  provider?: string;
  model?: string;
  baseUrl?: string;
}): CiRepairOrchestratorStageContext {
  return {
    stage: "created",
    runId: input.ciRepair.workflowRun.runId,
    counters: {
      orchestratorAttempt: 1,
      workerAttempt: 0,
      publishAttempt: 0,
      resumeCount: 0,
      approvalRound: 0
    },
    branchName: input.branchName,
    base: input.base,
    draft: input.draft,
    requestedWorker: input.worker,
    ...(input.provider === undefined ? {} : { requestedProvider: input.provider }),
    ...(input.model === undefined ? {} : { requestedModel: input.model }),
    ...(input.baseUrl === undefined ? {} : { requestedBaseUrl: input.baseUrl }),
    publishActionId: stableActionId("repo_publish_repair", [
      input.ciRepair.task.id,
      input.base,
      input.branchName,
      input.ciRepair.workflowRun.runId
    ]),
    pushActionId: stableActionId("git_push", [
      input.ciRepair.task.id,
      input.base,
      input.branchName,
      input.ciRepair.workflowRun.runId
    ]),
    branchPushed: false,
    prActionId: stableActionId("github_pr_create", [
      input.ciRepair.task.id,
      input.base,
      input.branchName,
      input.ciRepair.workflowRun.runId
    ]),
    workflowRun: input.ciRepair.workflowRun,
    evidence: evidenceSummary(input.ciRepair.evidence)
  };
}

export function buildPullRequestResumeContext(input: {
  ciRepair: CreateCiRepairTaskResult;
  branchName: string;
  base: string;
  draft: boolean;
  workerResult: CiRepairWorkerResult;
  commit?: CommitGitChangesResult;
  diffScope: GitDiffScopeVerification;
  verifierResult: RunTaskVerifiersResult;
}): CiRepairOrchestratorResumeContext {
  const evidence = evidenceSummary(input.ciRepair.evidence);

  return {
    stage: "ready_for_push",
    runId: input.ciRepair.workflowRun.runId,
    branchName: input.branchName,
    base: input.base,
    draft: input.draft,
    publishActionId: stableActionId("repo_publish_repair", [
      input.ciRepair.task.id,
      input.base,
      input.branchName,
      input.ciRepair.workflowRun.runId
    ]),
    pushActionId: stableActionId("git_push", [
      input.ciRepair.task.id,
      input.base,
      input.branchName,
      input.ciRepair.workflowRun.runId
    ]),
    branchPushed: false,
    prActionId: stableActionId("github_pr_create", [
      input.ciRepair.task.id,
      input.base,
      input.branchName,
      input.ciRepair.workflowRun.runId
    ]),
    workflowRun: input.ciRepair.workflowRun,
    evidence,
    verifierTask: input.verifierResult.task,
    verifierCommandResults: input.verifierResult.commandResults,
    workerResult: durableWorkerResult(input.workerResult),
    ...(input.commit === undefined ? {} : { commit: input.commit }),
    diffScope: input.diffScope
  };
}

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

export function publishCoverageFromContext(
  context: CiRepairOrchestratorResumeContext
): PublishCoverage | undefined {
  if (
    context.publishToolCallId === undefined ||
    context.publishPolicyDecisionId === undefined
  ) {
    return undefined;
  }

  return {
    toolCallId: context.publishToolCallId,
    policyDecisionId: context.publishPolicyDecisionId,
    ...(context.publishApprovalId === undefined
      ? {}
      : { approvalId: context.publishApprovalId })
  };
}

export function publishCoverageStagePatch(
  coverage: PublishCoverage
): Partial<CiRepairOrchestratorStageContext> {
  return {
    publishToolCallId: coverage.toolCallId,
    publishPolicyDecisionId: coverage.policyDecisionId,
    ...(coverage.approvalId === undefined
      ? {}
      : { publishApprovalId: coverage.approvalId })
  };
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
