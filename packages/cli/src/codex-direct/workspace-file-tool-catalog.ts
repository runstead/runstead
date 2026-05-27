import type { CodexResponsesTool } from "../codex-responses-transport.js";

import { objectSchema } from "./tool-schema.js";

export function codexDirectWorkspaceFileToolDefinitions(): CodexResponsesTool[] {
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
    }
  ];
}
