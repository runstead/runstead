import { isRecord } from "./tool-json.js";
import { requiredString } from "./tool-argument-strings.js";

export function optionalStringArray(
  value: unknown,
  field: string
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string" && value.length > 0) {
    return [value];
  }

  if (Array.isArray(value)) {
    const strings: string[] = [];

    for (const item of value) {
      if (typeof item !== "string" || item.length === 0) {
        throw new Error(
          `Codex Direct tool argument ${field} must be a string or an array of non-empty strings`
        );
      }

      strings.push(item);
    }

    return strings;
  }

  throw new Error(
    `Codex Direct tool argument ${field} must be a string or an array of non-empty strings`
  );
}

export function requiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `Codex Direct tool argument ${field} must be a non-empty array of non-empty strings`
    );
  }

  const strings = optionalStringArray(value, field);

  if (strings === undefined || strings.length === 0) {
    throw new Error(
      `Codex Direct tool argument ${field} must be a non-empty array of non-empty strings`
    );
  }

  return strings;
}

export function optionalReplacementArray(value: unknown):
  | {
      path: string;
      search: string;
      replace: string;
      replaceAll?: boolean;
    }[]
  | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error("Codex Direct tool argument replacements must be an array");
  }

  return value.map((item) => {
    if (!isRecord(item)) {
      throw new Error("Codex Direct replacement entries must be objects");
    }

    return {
      path: requiredString(item.path, "path"),
      search: requiredString(item.search, "search"),
      replace:
        typeof item.replace === "string"
          ? item.replace
          : requiredString(item.replace, "replace"),
      ...(item.replaceAll === undefined ? {} : { replaceAll: item.replaceAll === true })
    };
  });
}

export function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0
  );

  return strings.length === value.length ? strings : undefined;
}
