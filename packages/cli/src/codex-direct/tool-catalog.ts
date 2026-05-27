import type { CodexResponsesTool } from "../codex-responses-transport.js";

import { codexDirectGitEvidenceToolDefinitions } from "./git-evidence-tool-catalog.js";
import { codexDirectMutationToolDefinitions } from "./mutation-tool-catalog.js";
import { codexDirectWorkspaceToolDefinitions } from "./workspace-tool-catalog.js";

export { objectSchema } from "./tool-schema.js";

export function codexDirectToolDefinitions(): CodexResponsesTool[] {
  return [
    ...codexDirectWorkspaceToolDefinitions(),
    ...codexDirectMutationToolDefinitions(),
    ...codexDirectGitEvidenceToolDefinitions()
  ];
}
