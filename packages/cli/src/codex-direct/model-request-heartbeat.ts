import { sleep } from "./model-request-retry.js";
import { createModelRequestHeartbeatRecorder } from "./model-request-heartbeat-recorder.js";
import type {
  CodexDirectModelRequestWithHeartbeatInput,
  CodexDirectModelRequestWithHeartbeatResult
} from "./model-request-heartbeat-types.js";
import { recordCodexDirectModelRequestRetryAttempt } from "./model-request-retry-record.js";
import { modelRequestRetryStopError } from "./model-request-retry-stop.js";
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
      const stopError = modelRequestRetryStopError({
        error,
        attempts,
        maxRetries: input.maxRetries,
        retryCount,
        phase: input.phase
      });

      if (stopError !== undefined) {
        throw stopError;
      }

      retryCount += 1;
      const delayMs = recordCodexDirectModelRequestRetryAttempt({
        database: input.database,
        task: input.task,
        workerRun: input.workerRun,
        phase: input.phase,
        attempt: attempts,
        retryCount,
        maxRetries: input.maxRetries,
        retryBaseDelayMs: input.retryBaseDelayMs,
        retryMaxDelayMs: input.retryMaxDelayMs,
        retryJitterMs: input.retryJitterMs,
        error,
        elapsedMs: Date.now() - startedAt
      });
      await sleep(delayMs);
    }
  }
}
