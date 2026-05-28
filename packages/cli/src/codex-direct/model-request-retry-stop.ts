import type { CodexDirectModelRequestPhase } from "./worker-types.js";
import { errorMessage } from "./tool-json.js";
import { CodexDirectModelRetryExhaustedError } from "./model-request-interruptions.js";
import { isTransientModelRequestError } from "./model-request-retry.js";

export function modelRequestRetryStopError(input: {
  error: unknown;
  attempts: number;
  maxRetries: number;
  retryCount: number;
  phase: CodexDirectModelRequestPhase;
}): Error | undefined {
  const transient = isTransientModelRequestError(input.error);

  if (input.attempts <= input.maxRetries && transient) {
    return undefined;
  }

  if (input.retryCount > 0 && transient) {
    return new CodexDirectModelRetryExhaustedError({
      phase: input.phase,
      attempts: input.attempts,
      maxRetries: input.maxRetries,
      lastError: errorMessage(input.error)
    });
  }

  return input.error instanceof Error
    ? input.error
    : new Error(errorMessage(input.error));
}
