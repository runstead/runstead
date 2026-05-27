import type { CodexResponsesTool } from "../codex-responses-transport.js";

import { codexDirectPatchToolDefinitions } from "./patch-tool-catalog.js";
import { objectSchema } from "./tool-schema.js";

export function codexDirectMutationToolDefinitions(): CodexResponsesTool[] {
  return [
    ...codexDirectPatchToolDefinitions(),
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
    }
  ];
}
