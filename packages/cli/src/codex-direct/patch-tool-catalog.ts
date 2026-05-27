import type { CodexResponsesTool } from "../codex-responses-transport.js";

import { objectSchema } from "./tool-schema.js";

export function codexDirectPatchToolDefinitions(): CodexResponsesTool[] {
  return [
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
    }
  ];
}
