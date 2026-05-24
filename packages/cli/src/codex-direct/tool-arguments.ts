import { createHash } from "node:crypto";
import type { JsonObject } from "@runstead/core";

import type { ShellCommandResult } from "../shell-executor.js";
import type { CodexDirectToolCall, CodexDirectToolName } from "./tool-types.js";

export function safeJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;

    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function parseCodexDirectToolCall(input: {
  id: string;
  name: string;
  arguments: string;
}): CodexDirectToolCall {
  if (!isCodexDirectToolName(input.name)) {
    throw new Error(`Unsupported Codex Direct tool: ${input.name}`);
  }

  return {
    id: input.id,
    name: input.name,
    arguments: parseToolArguments(input.arguments)
  };
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

export function shellCommandOutput(result: ShellCommandResult): JsonObject {
  return {
    command: result.command,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    forceKilled: result.forceKilled,
    stdoutBytes: Buffer.byteLength(result.stdout, "utf8"),
    stderrBytes: Buffer.byteLength(result.stderr, "utf8"),
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated
  };
}

export function toolExecutionErrorOutput(error: unknown): JsonObject {
  return {
    ok: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "Error"
    }
  };
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Codex Direct tool argument ${field} must be a non-empty string`);
  }

  return value;
}

export function optionalString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return undefined;
}

export function optionalField<K extends string, V>(
  key: K,
  value: V | undefined
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

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

export function previewText(value: string): string {
  return value.length <= 500 ? value : `${value.slice(0, 500)}...`;
}

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

export function isCodexDirectToolName(value: string): value is CodexDirectToolName {
  return [
    "list_files",
    "search_text",
    "read_file",
    "read_many_files",
    "file_info",
    "tree",
    "package_scripts",
    "apply_patch",
    "run_verifier",
    "write_file",
    "run_command",
    "git_status",
    "git_diff",
    "git_log",
    "git_show",
    "diff_summary",
    "read_evidence",
    "workspace_facts"
  ].includes(value);
}

export function stableActionId(prefix: string, parts: unknown[]): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 12);

  return `act_${prefix.replaceAll(".", "_")}_${hash}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
