import type { PolicyDecisionRecord, Task, ToolCall, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { PolicyProfile } from "./policy.js";

export interface GovernedFilesystemOptions {
  cwd: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  task: Task;
  workerRun: WorkerRun;
  requestedBy: string;
  now?: Date;
}

export interface ReadGovernedWorkspaceFileOptions extends GovernedFilesystemOptions {
  path: string;
}

export interface WriteGovernedWorkspaceFileOptions extends GovernedFilesystemOptions {
  path: string;
  content: string;
  createDirs?: boolean;
}

export interface GovernedWorkspaceFileRead {
  path: string;
  content: string;
  bytes: number;
}

export interface GovernedWorkspaceFileWrite {
  path: string;
  bytes: number;
}

export interface GovernedFilesystemResult<T> {
  value: T;
  toolCall: ToolCall;
  policyDecision: PolicyDecisionRecord;
}
