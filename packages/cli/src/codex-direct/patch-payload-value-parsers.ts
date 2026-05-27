import type { CodexDirectPendingPatchPayload } from "./patch-payload-types.js";
import { isRecord } from "./tool-json.js";

export function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0
  );

  return strings.length === value.length ? strings : undefined;
}

export function replacementArray(
  value: unknown
): CodexDirectPendingPatchPayload["replacements"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const replacements: NonNullable<CodexDirectPendingPatchPayload["replacements"]> = [];

  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.path !== "string" ||
      typeof item.search !== "string" ||
      typeof item.replace !== "string"
    ) {
      return undefined;
    }

    replacements.push({
      path: item.path,
      search: item.search,
      replace: item.replace,
      ...(item.replaceAll === undefined ? {} : { replaceAll: item.replaceAll === true })
    });
  }

  return replacements;
}
