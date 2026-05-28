import type { CodexResponsesTool } from "../codex-responses-transport.js";

import { objectSchema } from "./tool-schema.js";

export function codexDirectWorkspaceFileListToolDefinitions(): CodexResponsesTool[] {
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
    }
  ];
}
