export function optionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  return undefined;
}

export function optionalNonNegativeInteger(
  value: unknown,
  field: string
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  throw new Error(`Codex Direct tool argument ${field} must be a non-negative integer`);
}

export function optionalTimeoutMs(value: unknown): { timeoutMs?: number } {
  const timeoutMs = optionalPositiveInteger(value);

  return timeoutMs === undefined ? {} : { timeoutMs };
}
