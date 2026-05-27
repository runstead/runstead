export function safeJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;

    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function parseToolArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    // Fall through to the consistent error below.
  }

  throw new Error("Codex Direct tool arguments must be a JSON object");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
