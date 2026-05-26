import type { Task } from "@runstead/core";
import type { CommandVerifierResult } from "@runstead/verifiers";

export interface RunTaskVerifiersOptions {
  cwd?: string;
  taskId: string;
  timeoutMs?: number;
  killGraceMs?: number;
  claim?: boolean;
  mode?: "finalize_task" | "evidence_only";
  now?: Date;
}

export type RunTaskVerifierCommandResult = CommandVerifierResult;

export interface RunTaskVerifiersResult {
  task: Task;
  commandResults: RunTaskVerifierCommandResult[];
}
