import type { CodexResponsesTool } from "../codex-responses-transport.js";

import { codexDirectWorkspaceFileListToolDefinitions } from "./workspace-file-list-tool-catalog.js";
import { codexDirectWorkspaceFileMetadataToolDefinitions } from "./workspace-file-metadata-tool-catalog.js";
import { codexDirectWorkspaceFileReadToolDefinitions } from "./workspace-file-read-tool-catalog.js";
import { codexDirectWorkspaceSearchToolDefinitions } from "./workspace-search-tool-catalog.js";

export function codexDirectWorkspaceFileToolDefinitions(): CodexResponsesTool[] {
  return [
    ...codexDirectWorkspaceFileListToolDefinitions(),
    ...codexDirectWorkspaceSearchToolDefinitions(),
    ...codexDirectWorkspaceFileReadToolDefinitions(),
    ...codexDirectWorkspaceFileMetadataToolDefinitions()
  ];
}
