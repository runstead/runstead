import type { Goal, RunsteadEvent, Task } from "@runstead/core";
import type { RuntimeExecutionSemantics } from "@runstead/runtime";

import type {
  GitCheckpointRunner,
  RestoreWorkspaceCheckpointResult,
  WorkspaceCheckpoint
} from "./checkpoints.js";
import type {
  CodexDirectTransport,
  CodexDirectWorkerResult
} from "./codex-direct-worker.js";
import type { LocalAgentAuditSummary } from "./local-agent-report.js";
import type { LocalAgentMode, LocalAgentWorkerKind } from "./local-agent-task-input.js";
import type { LocalAgentWorkerResult } from "./local-agent-result.js";
import type { StartupScaffoldProfile } from "./startup-scaffold-profile.js";
import type { CommandVerifierInput } from "./verifier-evidence.js";
import type { RunTaskVerifierCommandResult } from "./verifier-runner.js";
import type { WorkerProcessProgress, WorkerProcessRunner } from "./wrapped-worker.js";

export const LOCAL_AGENT_TASK_TYPE = "local_agent_task";

export interface CreateLocalAgentTaskOptions {
  cwd?: string;
  prompt: string;
  preset?: string;
  title?: string;
  worker?: LocalAgentWorkerKind;
  provider?: string;
  model?: string;
  baseUrl?: string;
  mode?: LocalAgentMode;
  allowedPaths?: string[];
  deniedPaths?: string[];
  approvalRequired?: string[];
  verifierCommands?: CommandVerifierInput[];
  maxTurns?: number;
  maxToolCalls?: number;
  maxFailedToolCalls?: number;
  modelRequestTimeoutMs?: number;
  modelRequestHeartbeatMs?: number;
  finalizeOnBudget?: boolean;
  scaffoldProfile?: StartupScaffoldProfile;
  gitDiffStaged?: boolean;
  gitDiffBase?: string;
  checkpoint?: boolean;
  commit?: boolean;
  now?: Date;
}

export interface CreateLocalAgentTaskResult {
  stateDb: string;
  goal: Goal;
  task: Task;
  events: RunsteadEvent[];
}

export interface RunLocalAgentTaskOptions {
  cwd?: string;
  taskId: string;
  transport?: CodexDirectTransport;
  workerRunner?: WorkerProcessRunner;
  workerProgressIntervalMs?: number;
  onWorkerProgress?: (progress: WorkerProcessProgress) => void;
  now?: Date;
}

export interface UndoLocalAgentTaskOptions {
  cwd?: string;
  taskId: string;
  actor?: string;
  allowHeadMismatch?: boolean;
  runner?: GitCheckpointRunner;
  now?: Date;
}

export interface UndoLocalAgentTaskResult {
  task: Task;
  checkpointId: string;
  restore: RestoreWorkspaceCheckpointResult;
}

export interface RunLocalAgentTaskResult {
  cwd: string;
  task: Task;
  goal: Goal;
  workerResult?: LocalAgentWorkerResult;
  status:
    | "completed"
    | "completed_with_warnings"
    | "waiting_approval"
    | "interrupted"
    | "blocked"
    | "failed";
  summary: string;
  execution: RuntimeExecutionSemantics;
  audit: LocalAgentAuditSummary;
  checkpoint?: WorkspaceCheckpoint;
  verifierResults?: RunTaskVerifierCommandResult[];
  approval?: CodexDirectWorkerResult["approval"];
}

export interface ResolveLocalAgentResumeTargetResult {
  taskId: string;
  approvalId?: string;
  note?: string;
}
