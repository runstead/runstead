import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { CodexDirectModelRequestPhase } from "./worker-types.js";
import { errorMessage } from "./tool-json.js";
import { recordModelRequestRetry } from "./model-request-audit.js";
import { modelRequestRetryDelayMs } from "./model-request-retry.js";

export function recordCodexDirectModelRequestRetryAttempt(input: {
  database: RunsteadDatabase;
  task: Task;
  workerRun: WorkerRun;
  phase: CodexDirectModelRequestPhase;
  attempt: number;
  retryCount: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  retryJitterMs: number;
  error: unknown;
  elapsedMs: number;
}): number {
  const delayMs = modelRequestRetryDelayMs({
    retryCount: input.retryCount,
    baseDelayMs: input.retryBaseDelayMs,
    maxDelayMs: input.retryMaxDelayMs,
    jitterMs: input.retryJitterMs
  });

  recordModelRequestRetry({
    database: input.database,
    task: input.task,
    workerRun: input.workerRun,
    phase: input.phase,
    attempt: input.attempt,
    nextAttempt: input.attempt + 1,
    maxRetries: input.maxRetries,
    reason: errorMessage(input.error),
    delayMs,
    elapsedMs: input.elapsedMs
  });

  return delayMs;
}
