import type { CodexResponsesTool } from "../codex-responses-transport.js";

import { codexDirectPatchToolDefinitions } from "./patch-tool-catalog.js";
import { codexDirectShellToolDefinitions } from "./shell-tool-catalog.js";
import { codexDirectVerifierToolDefinitions } from "./verifier-tool-catalog.js";
import { codexDirectWriteToolDefinitions } from "./write-tool-catalog.js";

export function codexDirectMutationToolDefinitions(): CodexResponsesTool[] {
  return [
    ...codexDirectPatchToolDefinitions(),
    ...codexDirectVerifierToolDefinitions(),
    ...codexDirectWriteToolDefinitions(),
    ...codexDirectShellToolDefinitions()
  ];
}
