export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? undefined : trimmed;
}

export function numberValue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}

export function arrayOfStrings(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();

    return trimmed.length === 0 ? [] : [trimmed];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function requiredStringValue(value: unknown, label: string): string {
  const parsed = stringValue(value);

  if (parsed === undefined) {
    throw new Error(`${label} must be a non-empty string`);
  }

  return parsed;
}

export function requiredNumberValue(value: unknown, label: string): number {
  const parsed = numberValue(value);

  if (parsed === undefined) {
    throw new Error(`${label} must be a number`);
  }

  return parsed;
}

export function unique(values: string[]): string[] {
  return [...new Set(values)];
}
