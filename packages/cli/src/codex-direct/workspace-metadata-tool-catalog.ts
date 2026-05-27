import type { CodexResponsesTool } from "../codex-responses-transport.js";

import { objectSchema } from "./tool-schema.js";

export function codexDirectWorkspaceMetadataToolDefinitions(): CodexResponsesTool[] {
  return [
    {
      type: "function",
      name: "package_scripts",
      description:
        "Inspect package.json scripts, package manager, workspace hints, turbo tasks, and verifier command candidates.",
      strict: false,
      parameters: objectSchema(
        {
          path: {
            type: "string",
            description:
              "Workspace-relative package directory. Defaults to the workspace root."
          }
        },
        []
      )
    }
  ];
}
