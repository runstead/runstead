import type { CodexResponsesTool } from "../codex-responses-transport.js";

export function codexDirectToolDefinitions(): CodexResponsesTool[] {
  return [
    {
      type: "function",
      name: "list_files",
      description:
        "List workspace files with stable relative paths, glob filters, default repository ignores, and bounded output.",
      strict: false,
      parameters: objectSchema(
        {
          glob: {
            oneOf: [
              {
                type: "string"
              },
              {
                type: "array",
                items: {
                  type: "string"
                }
              }
            ],
            description:
              "Optional glob pattern or patterns. Defaults to all non-ignored files."
          },
          exclude: {
            type: "array",
            items: {
              type: "string"
            },
            description: "Optional glob patterns to exclude."
          },
          maxResults: {
            type: "number",
            description: "Optional maximum number of entries to return."
          },
          includeDirs: {
            type: "boolean",
            description: "Include directory entries when true."
          }
        },
        []
      )
    },
    {
      type: "function",
      name: "search_text",
      description:
        "Search workspace text with bounded structured results. Returns path, line, and preview for each match.",
      strict: false,
      parameters: objectSchema(
        {
          query: {
            type: "string",
            description: "Text or regular expression to search for."
          },
          regex: {
            type: "boolean",
            description: "Treat query as a regular expression when true."
          },
          glob: {
            oneOf: [
              {
                type: "string"
              },
              {
                type: "array",
                items: {
                  type: "string"
                }
              }
            ],
            description: "Optional file glob or globs to search."
          },
          caseSensitive: {
            type: "boolean",
            description: "Use case-sensitive matching when true."
          },
          contextLines: {
            type: "number",
            description: "Optional surrounding line count per match."
          },
          maxMatches: {
            type: "number",
            description: "Optional maximum number of matches to return."
          },
          maxBytesPerFile: {
            type: "number",
            description: "Optional maximum bytes scanned per file."
          }
        },
        ["query"]
      )
    },
    {
      type: "function",
      name: "read_file",
      description: "Read a UTF-8 file inside the workspace.",
      strict: false,
      parameters: objectSchema(
        {
          path: {
            type: "string",
            description: "Workspace-relative file path."
          }
        },
        ["path"]
      )
    },
    {
      type: "function",
      name: "read_many_files",
      description:
        "Read multiple UTF-8 files inside the workspace with per-file and total byte limits.",
      strict: false,
      parameters: objectSchema(
        {
          paths: {
            type: "array",
            items: {
              type: "string"
            },
            description: "Workspace-relative file paths."
          },
          maxBytesPerFile: {
            type: "number",
            description: "Optional maximum bytes returned for each file."
          },
          maxTotalBytes: {
            type: "number",
            description: "Optional maximum bytes returned across all files."
          }
        },
        ["paths"]
      )
    },
    {
      type: "function",
      name: "file_info",
      description:
        "Return file or directory metadata including size, mtime, binary hint, and directory summary.",
      strict: false,
      parameters: objectSchema(
        {
          path: {
            type: "string",
            description: "Workspace-relative path. Defaults to the workspace root."
          },
          maxEntries: {
            type: "number",
            description:
              "Optional maximum child entries to include for directory summaries."
          }
        },
        []
      )
    },
    {
      type: "function",
      name: "tree",
      description:
        "Return a bounded tree view rooted at a workspace-relative directory path.",
      strict: false,
      parameters: objectSchema(
        {
          path: {
            type: "string",
            description: "Workspace-relative directory path. Defaults to root."
          },
          maxDepth: {
            type: "number",
            description: "Optional maximum tree depth."
          },
          maxEntries: {
            type: "number",
            description: "Optional maximum entries returned."
          },
          includeFiles: {
            type: "boolean",
            description: "Include file entries. Defaults to true."
          }
        },
        []
      )
    },
    {
      type: "function",
      name: "package_scripts",
      description:
        "Inspect package.json scripts, package manager, workspace hints, turbo tasks, and verifier command candidates.",
      strict: false,
      parameters: objectSchema(
        {
          path: {
            type: "string",
            description:
              "Workspace-relative package directory. Defaults to the workspace root."
          }
        },
        []
      )
    },
    {
      type: "function",
      name: "apply_patch",
      description:
        "Apply a unified diff or structured text replacements inside the workspace.",
      strict: false,
      parameters: objectSchema(
        {
          patch: {
            type: "string",
            description: "Unified diff to apply."
          },
          replacements: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: {
                  type: "string"
                },
                search: {
                  type: "string"
                },
                replace: {
                  type: "string"
                },
                replaceAll: {
                  type: "boolean"
                }
              },
              required: ["path", "search", "replace"],
              additionalProperties: false
            },
            description: "Structured search/replace edits to apply."
          }
        },
        []
      )
    },
    {
      type: "function",
      name: "run_verifier",
      description:
        "Run one declared or auto-discovered verifier command and record evidence.",
      strict: false,
      parameters: objectSchema(
        {
          name: {
            type: "string",
            description: "Verifier name, such as test, lint, or typecheck."
          },
          timeoutMs: {
            type: "number",
            description: "Optional verifier timeout in milliseconds."
          }
        },
        ["name"]
      )
    },
    {
      type: "function",
      name: "write_file",
      description: "Write a UTF-8 file inside the workspace.",
      strict: false,
      parameters: objectSchema(
        {
          path: {
            type: "string",
            description: "Workspace-relative file path."
          },
          content: {
            type: "string",
            description: "Complete file contents."
          },
          createDirs: {
            type: "boolean",
            description: "Create parent directories when true."
          }
        },
        ["path", "content"]
      )
    },
    {
      type: "function",
      name: "run_command",
      description: "Run a shell command in the workspace.",
      strict: false,
      parameters: objectSchema(
        {
          command: {
            type: "string",
            description: "Shell command to execute."
          },
          timeoutMs: {
            type: "number",
            description: "Optional command timeout in milliseconds."
          }
        },
        ["command"]
      )
    },
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

export function objectSchema(
  properties: Record<string, unknown>,
  required: string[]
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}
