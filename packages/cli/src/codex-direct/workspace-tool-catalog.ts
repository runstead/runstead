import type { CodexResponsesTool } from "../codex-responses-transport.js";

import { codexDirectWorkspaceFileToolDefinitions } from "./workspace-file-tool-catalog.js";
import { codexDirectWorkspaceMetadataToolDefinitions } from "./workspace-metadata-tool-catalog.js";

export function codexDirectWorkspaceToolDefinitions(): CodexResponsesTool[] {
  return [
    ...codexDirectWorkspaceFileToolDefinitions(),
    ...codexDirectWorkspaceMetadataToolDefinitions()
  ];
}
