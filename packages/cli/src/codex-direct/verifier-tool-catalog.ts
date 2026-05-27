import type { CodexResponsesTool } from "../codex-responses-transport.js";

import { objectSchema } from "./tool-schema.js";

export function codexDirectVerifierToolDefinitions(): CodexResponsesTool[] {
  return [
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
    }
  ];
}
