import type {
  CodexDirectInterruptionSummary,
  CodexDirectModelRequestPhase,
  CodexDirectWorkerOptions
} from "./worker-types.js";

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
