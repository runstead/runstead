import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

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
import { errorMessage, isRecord } from "./tool-arguments.js";
import { governedToolOptions, modelInferenceAction } from "./policy-actions.js";
import {
  CodexDirectModelRetryExhaustedError,
  CodexDirectModelTimeoutError
} from "./model-request-interruptions.js";
import {
  recordModelRequestHeartbeat,
  recordModelRequestRetry
} from "./model-request-audit.js";

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

export async function runSingleModelRequestWithHeartbeat(input: {
  timeoutMs: number;
  heartbeatMs: number;
  request: () => Promise<CodexResponsesResult>;
  recordHeartbeat: (stage: "started" | "waiting") => void;
  currentElapsedMs: () => number;
  heartbeatCount: () => number;
}): Promise<CodexResponsesResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  input.recordHeartbeat("started");

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(
        new CodexDirectModelTimeoutError({
          timeoutMs: input.timeoutMs,
          elapsedMs: input.currentElapsedMs(),
          heartbeatCount: input.heartbeatCount()
        })
      );
    }, input.timeoutMs);
    timeout.unref?.();
  });

  if (input.heartbeatMs > 0) {
    heartbeat = setInterval(() => {
      input.recordHeartbeat("waiting");
    }, input.heartbeatMs);
    heartbeat.unref?.();
  }

  try {
    return await Promise.race([input.request(), timeoutPromise]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (heartbeat !== undefined) {
      clearInterval(heartbeat);
    }
  }
}

export function modelRequestRetryDelayMs(input: {
  retryCount: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
}): number {
  const exponential = input.baseDelayMs * 2 ** Math.max(0, input.retryCount - 1);
  const capped = Math.min(exponential, input.maxDelayMs);
  const jitter =
    input.jitterMs <= 0 ? 0 : Math.floor(Math.random() * (input.jitterMs + 1));

  return Math.max(0, capped + jitter);
}

export function isTransientModelRequestError(error: unknown): boolean {
  if (error instanceof CodexDirectModelTimeoutError) {
    return false;
  }

  const message = errorMessage(error).toLowerCase();
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
  const transientNeedles = [
    "fetch failed",
    "network",
    "socket hang up",
    "connection reset",
    "temporarily unavailable",
    "timeout",
    "timed out",
    "econnreset",
    "etimedout",
    "econnrefused",
    "enotfound",
    "eai_again",
    "503",
    "502",
    "504",
    "429"
  ];

  return transientNeedles.some((needle) =>
    `${message} ${code.toLowerCase()}`.includes(needle)
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    timeout.unref?.();
  });
}
