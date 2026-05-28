import type { CodexResponsesTool } from "../codex-responses-transport.js";

import { objectSchema } from "./tool-schema.js";

export function codexDirectWorkspaceFileMetadataToolDefinitions(): CodexResponsesTool[] {
  return [
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
