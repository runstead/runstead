import { CodexDirectModelTimeoutError } from "./model-request-interruptions.js";
import { errorMessage, isRecord } from "./tool-json.js";

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
