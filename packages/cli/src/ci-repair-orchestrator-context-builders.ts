import type { CreateCiRepairTaskResult } from "./ci-repair.js";
import { stableActionId } from "./ci-repair-orchestrator-actions.js";
import {
  evidenceSummary,
  type CiRepairOrchestratorResumeContext,
  type CiRepairOrchestratorStageContext
} from "./ci-repair-orchestrator-context-types.js";
import type {
  CiRepairWorkerKind,
  CiRepairWorkerResult
} from "./ci-repair-orchestrator-types.js";
import { durableWorkerResult } from "./ci-repair-orchestrator-worker-output.js";
import type { GitDiffScopeVerification } from "./diff-scope-verifier.js";
import type { CommitGitChangesResult } from "./git-branch.js";
import type { RunTaskVerifiersResult } from "./verifier-runner.js";

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
