import type { Task } from "@runstead/core";

import type {
  CiRepairGitRunner,
  CiRepairWorkerKind,
  RunCiRepairOrchestratorOptions,
  RunCiRepairOrchestratorResult
} from "./ci-repair-orchestrator.js";
import type { CodexAuthStatus } from "./codex-auth.js";
import type { CodexDirectTransport } from "./codex-direct-worker.js";
import type { GitHubCliRunner } from "./github-actions.js";
import type { RunLocalAgentTaskResult } from "./local-agent.js";
import type {
  RunTaskVerifierCommandResult,
  RunTaskVerifiersOptions,
  RunTaskVerifiersResult
} from "./verifier-runner.js";
import type { WorkerProcessRunner } from "./wrapped-worker.js";

export interface RunOnceOptions {
  cwd?: string;
  authToken?: string;
  base?: string;
  draft?: boolean;
  worker?: CiRepairWorkerKind;
  provider?: string;
  model?: string;
  baseUrl?: string;
  allowedPaths?: string[];
  deniedPaths?: string[];
  githubRunner?: GitHubCliRunner;
  gitRunner?: CiRepairGitRunner;
  workerRunner?: WorkerProcessRunner;
  codexDirectTransport?: CodexDirectTransport;
  codexAuthStatus?: () => Promise<
    Pick<CodexAuthStatus, "loggedIn" | "accessTokenExpired">
  >;
  verifierRunner?: (
    options: RunTaskVerifiersOptions
  ) => Promise<RunTaskVerifiersResult>;
  ciRepairOrchestrator?: (
    options: RunCiRepairOrchestratorOptions
  ) => Promise<RunCiRepairOrchestratorResult>;
  now?: Date;
}

export type RunOnceResult = RunOnceNoTaskResult | RunOnceExecutedTaskResult;

export interface RunOnceNoTaskResult {
  cwd: string;
  ranTask: false;
  reason: "no_queued_task";
}

export interface RunOnceExecutedTaskResult {
  cwd: string;
  ranTask: true;
  task: Task;
  commandResults?: RunTaskVerifierCommandResult[];
  ciRepairResult?: RunCiRepairOrchestratorResult;
  localAgentResult?: RunLocalAgentTaskResult;
}
