import type { CodexResponsesTool } from "../codex-responses-transport.js";

import { objectSchema } from "./tool-schema.js";
import { codexDirectWorkspaceFileListToolDefinitions } from "./workspace-file-list-tool-catalog.js";
import { codexDirectWorkspaceSearchToolDefinitions } from "./workspace-search-tool-catalog.js";

export function codexDirectWorkspaceFileToolDefinitions(): CodexResponsesTool[] {
  return [
    ...codexDirectWorkspaceFileListToolDefinitions(),
    ...codexDirectWorkspaceSearchToolDefinitions(),
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
