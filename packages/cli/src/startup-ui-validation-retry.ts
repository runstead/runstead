import type {
  StartupUiBrowserRunner,
  StartupUiBrowserRunnerInput,
  StartupUiBrowserRunnerResult,
  StartupUiValidationFailureCategory
} from "./startup-ui-validation.js";

export async function runStartupUiBrowserRunnerWithRetry(
  runner: StartupUiBrowserRunner,
  input: StartupUiBrowserRunnerInput
): Promise<{
  result: StartupUiBrowserRunnerResult;
  retryCount: number;
  retryReason?: string;
}> {
  try {
    return {
      result: await runner(input),
      retryCount: 0
    };
  } catch (error) {
    if (!isRetryableStartupUiInfraError(error)) {
      throw error;
    }

    const retryReason = errorMessage(error);

    try {
      return {
        result: await runner(input),
        retryCount: 1,
        retryReason
      };
    } catch (retryError) {
      throw new StartupUiBrowserRetryError(retryReason, errorMessage(retryError));
    }
  }
}

export function startupUiExecutionErrorCategory(
  message: string
): StartupUiValidationFailureCategory {
  const text = message.toLowerCase();

  if (
    text.includes("chrome") ||
    text.includes("devtools") ||
    text.includes("playwright") ||
    text.includes("browser") ||
    text.includes("executable") ||
    text.includes("profile")
  ) {
    return "browser_runtime";
  }

  if (
    text.includes("econnrefused") ||
    text.includes("connection refused") ||
    text.includes("timed out")
  ) {
    return "network";
  }

  if (text.includes("selector")) {
    return "selector_unstable";
  }

  return "unknown";
}

export function startupUiExecutionRetryCount(error: unknown): number | undefined {
  return error instanceof StartupUiBrowserRetryError ? error.retryCount : undefined;
}

export function startupUiExecutionRetryReason(error: unknown): string | undefined {
  return error instanceof StartupUiBrowserRetryError ? error.retryReason : undefined;
}

function isRetryableStartupUiInfraError(error: unknown): boolean {
  const category = startupUiExecutionErrorCategory(errorMessage(error));

  return category === "browser_runtime" || category === "network";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class StartupUiBrowserRetryError extends Error {
  readonly retryCount = 1;
  readonly retryReason: string;

  constructor(firstMessage: string, retryMessage: string) {
    super(
      `UI smoke browser infrastructure failed after retry: ${retryMessage}; first failure: ${firstMessage}`
    );
    this.name = "StartupUiBrowserRetryError";
    this.retryReason = firstMessage;
  }
}
