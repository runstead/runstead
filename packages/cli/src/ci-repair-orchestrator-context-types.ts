import type { Evidence, JsonObject, Task } from "@runstead/core";

import type {
  CiRepairWorkerKind,
  CiRepairWorkerResult
} from "./ci-repair-orchestrator-types.js";
import type { WorkspaceCheckpoint } from "./checkpoints.js";
import type { GitDiffScopeVerification } from "./diff-scope-verifier.js";
import type { CommitGitChangesResult } from "./git-branch.js";
import type { GitHubWorkflowRunStatus } from "./github-actions.js";
import type { RunTaskVerifiersResult } from "./verifier-runner.js";

export interface CiRepairOrchestratorStageContext extends JsonObject {
  stage: string;
  runId: string;
  counters?: CiRepairOrchestratorCounters;
  branchName?: string;
  base?: string;
  draft?: boolean;
  requestedWorker?: CiRepairWorkerKind;
  requestedProvider?: string;
  requestedModel?: string;
  requestedBaseUrl?: string;
  publishActionId?: string;
  pushActionId?: string;
  branchPushed?: boolean;
  prActionId?: string;
  workflowRun?: GitHubWorkflowRunStatus;
  evidence?: EvidenceSummary;
  checkpointBefore?: WorkspaceCheckpoint;
  verifierTask?: Task;
  verifierCommandResults?: RunTaskVerifiersResult["commandResults"];
  workerResult?: CiRepairWorkerResult;
  commit?: CommitGitChangesResult;
  diffScope?: GitDiffScopeVerification;
  approvalId?: string;
  publishToolCallId?: string;
  publishPolicyDecisionId?: string;
  publishApprovalId?: string;
}

export interface CiRepairOrchestratorResumeContext extends JsonObject {
  stage: string;
  runId: string;
  counters?: CiRepairOrchestratorCounters;
  branchName: string;
  base: string;
  draft: boolean;
  requestedWorker?: CiRepairWorkerKind;
  requestedProvider?: string;
  requestedModel?: string;
  requestedBaseUrl?: string;
  publishActionId: string;
  pushActionId: string;
  branchPushed: boolean;
  prActionId: string;
  workflowRun: GitHubWorkflowRunStatus;
  evidence: EvidenceSummary;
  verifierTask: Task;
  verifierCommandResults: RunTaskVerifiersResult["commandResults"];
  workerResult: CiRepairWorkerResult;
  commit?: CommitGitChangesResult;
  diffScope: GitDiffScopeVerification;
  approvalId?: string;
  publishToolCallId?: string;
  publishPolicyDecisionId?: string;
  publishApprovalId?: string;
}

export interface PublishCoverage {
  toolCallId: string;
  policyDecisionId: string;
  approvalId?: string;
}

export interface CiRepairOrchestratorCounters extends JsonObject {
  orchestratorAttempt: number;
  workerAttempt: number;
  publishAttempt: number;
  resumeCount: number;
  approvalRound: number;
}

export type CiRepairOrchestratorCounterName =
  | "orchestratorAttempt"
  | "workerAttempt"
  | "publishAttempt"
  | "resumeCount"
  | "approvalRound";

export interface EvidenceSummary extends JsonObject {
  id: string;
  type: string;
  subjectType: string;
  subjectId: string;
  uri: string;
  summary?: string;
  hash?: string;
  createdAt: string;
}

export function evidenceSummary(evidence: Evidence): EvidenceSummary {
  return {
    id: evidence.id,
    type: evidence.type,
    subjectType: evidence.subjectType,
    subjectId: evidence.subjectId,
    uri: evidence.uri,
    ...(evidence.summary === undefined ? {} : { summary: evidence.summary }),
    ...(evidence.hash === undefined ? {} : { hash: evidence.hash }),
    createdAt: evidence.createdAt
  };
}
