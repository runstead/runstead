import type { Task } from "@runstead/core";

import type { CreateCiRepairTaskFromWorkflowRunResult } from "./ci-repair.js";
import type {
  CodexDirectTransport,
  CodexDirectWorkerResult
} from "./codex-direct-worker.js";
import type { WorkspaceCheckpoint } from "./checkpoints.js";
import type { CommitGitChangesResult, GitRunner } from "./git-branch.js";
import type { GitHubCliRunner } from "./github-actions.js";
import type { CreateGitHubPullRequestResult } from "./github-pr.js";
import type { GitDiffRunner, GitDiffScopeVerification } from "./diff-scope-verifier.js";
import type {
  RunTaskVerifiersOptions,
  RunTaskVerifiersResult
} from "./verifier-runner.js";
import type { CommandVerifierInput } from "./verifier-evidence.js";
import type {
  WorkerProcessRunner,
  WrappedWorkerKind,
  WrappedWorkerRunResult
} from "./wrapped-worker.js";

export type CiRepairGitRunner = GitRunner & GitDiffRunner;
export type CiRepairWorkerKind = WrappedWorkerKind | "codex_direct";
export type CodexDirectCiRepairWorkerResult = CodexDirectWorkerResult & {
  checkpointBefore?: WorkspaceCheckpoint;
};
export type CiRepairWorkerResult =
  | WrappedWorkerRunResult
  | CodexDirectCiRepairWorkerResult;

export interface RunCiRepairOrchestratorOptions {
  cwd?: string;
  runId: string;
  worker: CiRepairWorkerKind;
  provider?: string;
  model?: string;
  baseUrl?: string;
  base?: string;
  draft?: boolean;
  allowedPaths?: string[];
  deniedPaths?: string[];
  verifierCommands: CommandVerifierInput[];
  authToken?: string;
  githubRunner?: GitHubCliRunner;
  gitRunner?: CiRepairGitRunner;
  workerRunner?: WorkerProcessRunner;
  codexDirectTransport?: CodexDirectTransport;
  verifierRunner?: (
    options: RunTaskVerifiersOptions
  ) => Promise<RunTaskVerifiersResult>;
  onStagePersisted?: (stage: string, task: Task) => void;
  now?: Date;
}

export interface RunCiRepairOrchestratorResult {
  status: "completed" | "waiting_approval" | "ignored";
  ciRepair: CreateCiRepairTaskFromWorkflowRunResult;
  branchName?: string;
  workerResult?: CiRepairWorkerResult;
  commit?: CommitGitChangesResult;
  diffScope?: GitDiffScopeVerification;
  verifierResult?: RunTaskVerifiersResult;
  pullRequest?: CreateGitHubPullRequestResult;
  approval?: {
    id: string;
    actionId: string;
    policyDecisionId: string;
    reason: string;
  };
}
