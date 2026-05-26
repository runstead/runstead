import type { Evidence, RunsteadEvent, Task } from "@runstead/core";

import type {
  GitHubCliRunner,
  GitHubWorkflowRunLog,
  GitHubWorkflowRunStatus
} from "./github-actions.js";
import type { CommandVerifierInput } from "./verifier-evidence.js";

export interface CreateCiRepairTaskOptions {
  cwd?: string;
  runId: string;
  authToken?: string;
  runner?: GitHubCliRunner;
  verifierCommands?: CommandVerifierInput[];
  now?: Date;
}

export interface CreateCiRepairTaskResult {
  status: "created";
  cwd: string;
  stateDb: string;
  task: Task;
  event: RunsteadEvent;
  evidence: Evidence;
  evidencePath: string;
  workflowRun: GitHubWorkflowRunStatus;
  log: GitHubWorkflowRunLog;
  created: boolean;
}

export interface IgnoredCiRepairTaskResult {
  status: "ignored";
  reason: "workflow_not_repairable";
  taskStatus: "cancelled";
  cwd: string;
  stateDb: string;
  task: Task;
  event: RunsteadEvent;
  workflowRun: GitHubWorkflowRunStatus;
  log: GitHubWorkflowRunLog;
  created: boolean;
  error: string;
}

export type CreateCiRepairTaskFromWorkflowRunResult =
  | CreateCiRepairTaskResult
  | IgnoredCiRepairTaskResult;
