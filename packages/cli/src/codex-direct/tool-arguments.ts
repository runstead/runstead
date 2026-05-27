import { createHash } from "node:crypto";

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
