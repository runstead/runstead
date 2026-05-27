import type { CodexResponsesTool } from "../codex-responses-transport.js";

import { objectSchema } from "./tool-schema.js";

export function codexDirectGitEvidenceToolDefinitions(): CodexResponsesTool[] {
  return [
    {
      type: "function",
      name: "git_status",
      description: "Return concise git status for the workspace.",
      strict: false,
      parameters: objectSchema({}, [])
    },
    {
      type: "function",
      name: "git_diff",
      description: "Return git diff for the workspace.",
      strict: false,
      parameters: objectSchema(
        {
          path: {
            type: "string",
            description: "Optional workspace-relative path to diff."
          },
          staged: {
            type: "boolean",
            description: "Return the staged diff when true."
          },
          base: {
            type: "string",
            description: "Optional base ref for base...HEAD diffs."
          }
        },
        []
      )
    },
    {
      type: "function",
      name: "git_log",
      description: "Return bounded git commit history for the workspace.",
      strict: false,
      parameters: objectSchema(
        {
          range: {
            type: "string",
            description: "Optional git revision range."
          },
          path: {
            type: "string",
            description: "Optional workspace-relative path to filter history."
          },
          maxCommits: {
            type: "number",
            description: "Optional maximum commits to return."
          }
        },
        []
      )
    },
    {
      type: "function",
      name: "git_show",
      description: "Return bounded git show output for a commit or ref.",
      strict: false,
      parameters: objectSchema(
        {
          ref: {
            type: "string",
            description: "Commit or ref to show."
          },
          path: {
            type: "string",
            description: "Optional workspace-relative path to show."
          },
          maxBytes: {
            type: "number",
            description: "Optional maximum stdout/stderr bytes to capture."
          }
        },
        ["ref"]
      )
    },
    {
      type: "function",
      name: "diff_summary",
      description:
        "Return a bounded file-level summary of the workspace git diff without full patch contents.",
      strict: false,
      parameters: objectSchema(
        {
          path: {
            type: "string",
            description: "Optional workspace-relative path to summarize."
          },
          staged: {
            type: "boolean",
            description: "Summarize staged diff when true."
          },
          base: {
            type: "string",
            description: "Optional base ref for base...HEAD summaries."
          },
          maxFiles: {
            type: "number",
            description: "Optional maximum file rows to return."
          }
        },
        []
      )
    },
    {
      type: "function",
      name: "read_evidence",
      description:
        "Read a Runstead evidence record and bounded local artifact contents by evidence id.",
      strict: false,
      parameters: objectSchema(
        {
          id: {
            type: "string",
            description: "Runstead evidence id."
          },
          maxBytes: {
            type: "number",
            description: "Optional maximum artifact bytes to return."
          }
        },
        ["id"]
      )
    },
    {
      type: "function",
      name: "workspace_facts",
      description:
        "Return cached structured workspace facts, refreshing repo inspection evidence when requested.",
      strict: false,
      parameters: objectSchema(
        {
          refresh: {
            type: "boolean",
            description:
              "Collect fresh workspace facts instead of using cached evidence."
          }
        },
        []
      )
    }
  ];
}
