import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { CodexResponsesResult } from "../codex-responses-transport.js";
import type { CodexDirectModelRequestPhase } from "./worker-types.js";
import { errorMessage } from "./tool-json.js";
import { CodexDirectModelRetryExhaustedError } from "./model-request-interruptions.js";
import {
  recordModelRequestHeartbeat,
  recordModelRequestRetry
} from "./model-request-audit.js";
import {
  isTransientModelRequestError,
  modelRequestRetryDelayMs,
  sleep
} from "./model-request-retry.js";
import { runSingleModelRequestWithHeartbeat } from "./model-request-single.js";

export {
  isTransientModelRequestError,
  modelRequestRetryDelayMs,
  sleep
} from "./model-request-retry.js";
export { runSingleModelRequestWithHeartbeat } from "./model-request-single.js";

export async function runModelRequestWithHeartbeat(input: {
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
}): Promise<{
  value: CodexResponsesResult;
  elapsedMs: number;
  heartbeatCount: number;
  attempts: number;
  retryCount: number;
}> {
  const startedAt = Date.now();
  let attempts = 0;
  let retryCount = 0;
  let heartbeatCount = 0;

  const recordHeartbeat = (stage: "started" | "waiting"): void => {
    heartbeatCount += 1;
    recordModelRequestHeartbeat({
      database: input.database,
      task: input.task,
      workerRun: input.workerRun,
      sequence: heartbeatCount,
      stage,
      phase: input.phase,
      elapsedMs: Date.now() - startedAt,
      timeoutMs: input.timeoutMs
    });
  };

  while (true) {
    attempts += 1;

    try {
      const value = await runSingleModelRequestWithHeartbeat({
        timeoutMs: input.timeoutMs,
        heartbeatMs: input.heartbeatMs,
        request: input.request,
        recordHeartbeat,
        currentElapsedMs: () => Date.now() - startedAt,
        heartbeatCount: () => heartbeatCount
      });

      return {
        value,
        elapsedMs: Date.now() - startedAt,
        heartbeatCount,
        attempts,
        retryCount
      };
    } catch (error) {
      if (attempts > input.maxRetries || !isTransientModelRequestError(error)) {
        if (retryCount > 0 && isTransientModelRequestError(error)) {
          throw new CodexDirectModelRetryExhaustedError({
            phase: input.phase,
            attempts,
            maxRetries: input.maxRetries,
            lastError: errorMessage(error)
          });
        }

        throw error;
      }

      retryCount += 1;
      const delayMs = modelRequestRetryDelayMs({
        retryCount,
        baseDelayMs: input.retryBaseDelayMs,
        maxDelayMs: input.retryMaxDelayMs,
        jitterMs: input.retryJitterMs
      });

      recordModelRequestRetry({
        database: input.database,
        task: input.task,
        workerRun: input.workerRun,
        phase: input.phase,
        attempt: attempts,
        nextAttempt: attempts + 1,
        maxRetries: input.maxRetries,
        reason: errorMessage(error),
        delayMs,
        elapsedMs: Date.now() - startedAt
      });
      await sleep(delayMs);
    }
  }
}
