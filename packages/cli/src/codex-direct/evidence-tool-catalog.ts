import type { CodexResponsesTool } from "../codex-responses-transport.js";

import { objectSchema } from "./tool-schema.js";

export function codexDirectEvidenceToolDefinitions(): CodexResponsesTool[] {
  return [
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
