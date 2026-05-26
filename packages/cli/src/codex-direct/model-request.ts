import type { WorkerRun } from "@runstead/core";

import type {
  CodexResponsesRequest,
  CodexResponsesResult
} from "../codex-responses-transport.js";
import { runGovernedToolAction } from "../governed-action.js";
import {
  DEFAULT_CODEX_DIRECT_FINAL_SUMMARY_REQUEST_TIMEOUT_MS,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_HEARTBEAT_MS,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_MAX_RETRIES,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_BASE_DELAY_MS,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_JITTER_MS,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_MAX_DELAY_MS,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_TIMEOUT_MS
} from "./constants.js";
import type {
  CodexDirectModelRequestPhase,
  CodexDirectWorkerOptions
} from "./worker-types.js";
import { governedToolOptions, modelInferenceAction } from "./policy-actions.js";
import { runModelRequestWithHeartbeat } from "./model-request-heartbeat.js";

export {
  recordModelRequestHeartbeat,
  recordModelRequestRetry
} from "./model-request-audit.js";

export {
  CodexDirectModelRetryExhaustedError,
  CodexDirectModelTimeoutError,
  modelRetryExhaustedInterruption,
  modelTimeoutInterruption
} from "./model-request-interruptions.js";
export {
  isTransientModelRequestError,
  modelRequestRetryDelayMs,
  runModelRequestWithHeartbeat,
  runSingleModelRequestWithHeartbeat,
  sleep
} from "./model-request-heartbeat.js";

export async function runGovernedModelInference(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    request: CodexResponsesRequest;
    phase?: CodexDirectModelRequestPhase;
  }
): Promise<CodexResponsesResult> {
  const phase = options.phase ?? "conversation";

  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: modelInferenceAction({
      task: options.task,
      model: options.model,
      ...(options.modelProviderResourceId === undefined
        ? {}
        : { providerResourceId: options.modelProviderResourceId }),
      ...(options.modelProviderNetworkDomains === undefined
        ? {}
        : { networkDomains: options.modelProviderNetworkDomains })
    }),
    run: async () => {
      const modelRequest = await runModelRequestWithHeartbeat({
        database: options.database,
        task: options.task,
        workerRun: options.workerRun,
        phase,
        timeoutMs: modelRequestTimeoutMs(options, phase),
        heartbeatMs:
          options.modelRequestHeartbeatMs ??
          DEFAULT_CODEX_DIRECT_MODEL_REQUEST_HEARTBEAT_MS,
        maxRetries:
          options.modelRequestMaxRetries ??
          DEFAULT_CODEX_DIRECT_MODEL_REQUEST_MAX_RETRIES,
        retryBaseDelayMs:
          options.modelRequestRetryBaseDelayMs ??
          DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_BASE_DELAY_MS,
        retryMaxDelayMs:
          options.modelRequestRetryMaxDelayMs ??
          DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_MAX_DELAY_MS,
        retryJitterMs:
          options.modelRequestRetryJitterMs ??
          DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_JITTER_MS,
        request: () => options.transport.createResponse(options.request)
      });
      const value = modelRequest.value;

      return {
        value,
        output: {
          model: options.model,
          status: value.status ?? "unknown",
          finishReason: value.finishReason,
          phase,
          elapsedMs: modelRequest.elapsedMs,
          heartbeatCount: modelRequest.heartbeatCount,
          attempts: modelRequest.attempts,
          retryCount: modelRequest.retryCount,
          toolCalls: value.toolCalls.length,
          outputTextBytes: Buffer.byteLength(value.outputText, "utf8")
        }
      };
    }
  }).then((result) => result.value);
}

export function modelRequestTimeoutMs(
  options: CodexDirectWorkerOptions,
  phase: CodexDirectModelRequestPhase
): number {
  const defaultTimeout =
    phase === "final_summary"
      ? DEFAULT_CODEX_DIRECT_FINAL_SUMMARY_REQUEST_TIMEOUT_MS
      : DEFAULT_CODEX_DIRECT_MODEL_REQUEST_TIMEOUT_MS;
  const configured =
    phase === "final_summary"
      ? (options.modelFinalSummaryRequestTimeoutMs ?? options.modelRequestTimeoutMs)
      : options.modelRequestTimeoutMs;

  return configured ?? defaultTimeout;
}
