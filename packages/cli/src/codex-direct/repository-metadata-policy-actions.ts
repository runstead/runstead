import type { ActionEnvelope } from "../policy.js";

import { stableActionId } from "./tool-action-id.js";

export function repositoryMetadataReadAction(input: {
  cwd: string;
  path: string;
}): ActionEnvelope {
  return {
    actionId: stableActionId("repo.metadata.read", [input.cwd, input.path]),
    actionType: "repo.metadata.read",
    resource: {
      type: "package_manifest",
      path: input.path
    },
    context: {
      cwd: input.cwd,
      filesTouched: [
        input.path === "." ? "package.json" : `${input.path}/package.json`,
        input.path === "."
          ? "pnpm-workspace.yaml"
          : `${input.path}/pnpm-workspace.yaml`,
        input.path === "." ? "turbo.json" : `${input.path}/turbo.json`
      ]
    }
  };
}
