import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { CodexResponsesResult } from "../codex-responses-transport.js";
import type { CodexDirectModelRequestPhase } from "./worker-types.js";

export interface CodexDirectModelRequestWithHeartbeatInput {
  database: RunsteadDatabase;
  task: Task;
  workerRun: WorkerRun;
  phase: CodexDirectModelRequestPhase;
  timeoutMs: number;
  heartbeatMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  retryJitterMs: number;
  request: () => Promise<CodexResponsesResult>;
}

export interface CodexDirectModelRequestWithHeartbeatResult {
  value: CodexResponsesResult;
  elapsedMs: number;
  heartbeatCount: number;
  attempts: number;
  retryCount: number;
}
