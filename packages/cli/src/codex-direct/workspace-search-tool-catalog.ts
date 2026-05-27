import type { CodexResponsesTool } from "../codex-responses-transport.js";

import { objectSchema } from "./tool-schema.js";

export function codexDirectWorkspaceSearchToolDefinitions(): CodexResponsesTool[] {
  return [
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
    }
  ];
}
