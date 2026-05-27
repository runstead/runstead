import type { CodexDirectToolCall, CodexDirectToolName } from "./tool-types.js";
import { parseToolArguments } from "./tool-json.js";

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
