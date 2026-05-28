import { errorMessage } from "./tool-json.js";
import { CodexDirectModelRetryExhaustedError } from "./model-request-interruptions.js";
import { recordModelRequestRetry } from "./model-request-audit.js";
import {
  isTransientModelRequestError,
  modelRequestRetryDelayMs,
  sleep
} from "./model-request-retry.js";
import { createModelRequestHeartbeatRecorder } from "./model-request-heartbeat-recorder.js";
import type {
  CodexDirectModelRequestWithHeartbeatInput,
  CodexDirectModelRequestWithHeartbeatResult
} from "./model-request-heartbeat-types.js";
import { runSingleModelRequestWithHeartbeat } from "./model-request-single.js";

export {
  isTransientModelRequestError,
  modelRequestRetryDelayMs,
  sleep
} from "./model-request-retry.js";
export { runSingleModelRequestWithHeartbeat } from "./model-request-single.js";
export type {
  CodexDirectModelRequestWithHeartbeatInput,
  CodexDirectModelRequestWithHeartbeatResult
} from "./model-request-heartbeat-types.js";

export async function runModelRequestWithHeartbeat(
  input: CodexDirectModelRequestWithHeartbeatInput
): Promise<CodexDirectModelRequestWithHeartbeatResult> {
  const startedAt = Date.now();
  let attempts = 0;
  let retryCount = 0;
  const heartbeat = createModelRequestHeartbeatRecorder({
    database: input.database,
    task: input.task,
    workerRun: input.workerRun,
    phase: input.phase,
    timeoutMs: input.timeoutMs,
    startedAt
  });

  while (true) {
    attempts += 1;

    try {
      const value = await runSingleModelRequestWithHeartbeat({
        timeoutMs: input.timeoutMs,
        heartbeatMs: input.heartbeatMs,
        request: input.request,
        recordHeartbeat: heartbeat.record,
        currentElapsedMs: () => Date.now() - startedAt,
        heartbeatCount: heartbeat.count
      });

      return {
        value,
        elapsedMs: Date.now() - startedAt,
        heartbeatCount: heartbeat.count(),
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
