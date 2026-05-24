import { createRunsteadId, type Task, type WorkerRun } from "@runstead/core";
import { appendEventAndProject, type RunsteadDatabase } from "@runstead/state-sqlite";

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
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_TIMEOUT_MS,
  EXECUTION_LEASE_MS
} from "./constants.js";
import type {
  CodexDirectInterruptionSummary,
  CodexDirectModelRequestPhase,
  CodexDirectWorkerOptions
} from "./worker.js";
import { errorMessage, isRecord } from "./tool-arguments.js";
import { governedToolOptions, modelInferenceAction } from "./policy-actions.js";

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

export function recordModelRequestHeartbeat(input: {
  database: RunsteadDatabase;
  task: Task;
  workerRun: WorkerRun;
  sequence: number;
  stage: "started" | "waiting";
  phase: CodexDirectModelRequestPhase;
  elapsedMs: number;
  timeoutMs: number;
}): void {
  const heartbeatAt = new Date().toISOString();
  const leaseExpiresAt = new Date(Date.now() + EXECUTION_LEASE_MS).toISOString();

  appendEventAndProject(input.database, {
    event: {
      eventId: createRunsteadId("evt"),
      type: "worker_run.heartbeat",
      aggregateType: "worker_run",
      aggregateId: input.workerRun.id,
      payload: {
        workerRunId: input.workerRun.id,
        taskId: input.task.id,
        phase: "model_inference_request",
        requestPhase: input.phase,
        stage: input.stage,
        sequence: input.sequence,
        elapsedMs: input.elapsedMs,
        timeoutMs: input.timeoutMs
      },
      createdAt: heartbeatAt
    }
  });
  input.database
    .prepare(
      `
      UPDATE worker_runs
      SET heartbeat_at = ?, lease_expires_at = ?
      WHERE id = ? AND status = 'running'
    `
    )
    .run(heartbeatAt, leaseExpiresAt, input.workerRun.id);
  input.database
    .prepare(
      `
      UPDATE tasks
      SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = 'running'
    `
    )
    .run(heartbeatAt, leaseExpiresAt, heartbeatAt, input.task.id);
}

export function recordModelRequestRetry(input: {
  database: RunsteadDatabase;
  task: Task;
  workerRun: WorkerRun;
  phase: CodexDirectModelRequestPhase;
  attempt: number;
  nextAttempt: number;
  maxRetries: number;
  reason: string;
  delayMs: number;
  elapsedMs: number;
}): void {
  const createdAt = new Date().toISOString();

  appendEventAndProject(input.database, {
    event: {
      eventId: createRunsteadId("evt"),
      type: "model_request.retry",
      aggregateType: "worker_run",
      aggregateId: input.workerRun.id,
      payload: {
        workerRunId: input.workerRun.id,
        taskId: input.task.id,
        phase: input.phase,
        attempt: input.attempt,
        nextAttempt: input.nextAttempt,
        maxRetries: input.maxRetries,
        reason: input.reason,
        delayMs: input.delayMs,
        elapsedMs: input.elapsedMs
      },
      createdAt
    }
  });
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

export class CodexDirectModelTimeoutError extends Error {
  readonly reason = "model_timeout";
  readonly timeoutMs: number;
  readonly elapsedMs: number;
  readonly heartbeatCount: number;

  constructor(input: { timeoutMs: number; elapsedMs: number; heartbeatCount: number }) {
    super(
      `Codex Direct model request timed out after ${input.timeoutMs}ms; runstead marked the task interrupted:model_timeout.`
    );
    this.timeoutMs = input.timeoutMs;
    this.elapsedMs = input.elapsedMs;
    this.heartbeatCount = input.heartbeatCount;
  }
}

export class CodexDirectModelRetryExhaustedError extends Error {
  readonly reason = "model_request_retries_exhausted";
  readonly phase: CodexDirectModelRequestPhase;
  readonly attempts: number;
  readonly maxRetries: number;
  readonly lastError: string;

  constructor(input: {
    phase: CodexDirectModelRequestPhase;
    attempts: number;
    maxRetries: number;
    lastError: string;
  }) {
    super(
      `Codex Direct model request retry budget exhausted after ${input.attempts} attempts in ${input.phase}: ${input.lastError}`
    );
    this.phase = input.phase;
    this.attempts = input.attempts;
    this.maxRetries = input.maxRetries;
    this.lastError = input.lastError;
  }
}

export function modelTimeoutInterruption(
  options: Pick<CodexDirectWorkerOptions, "task">,
  error: CodexDirectModelTimeoutError
): CodexDirectInterruptionSummary {
  return {
    reason: error.reason,
    timeoutMs: error.timeoutMs,
    elapsedMs: error.elapsedMs,
    heartbeatCount: error.heartbeatCount,
    retryCommand: `runstead resume && runstead agent resume ${options.task.id}`
  };
}

export function modelRetryExhaustedInterruption(
  options: Pick<CodexDirectWorkerOptions, "task">,
  error: CodexDirectModelRetryExhaustedError
): CodexDirectInterruptionSummary {
  return {
    reason: error.reason,
    phase: error.phase,
    attempts: error.attempts,
    maxRetries: error.maxRetries,
    lastError: error.lastError,
    retryCommand: `runstead resume && runstead agent resume ${options.task.id}`
  };
}
