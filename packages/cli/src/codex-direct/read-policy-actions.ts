import type { ActionEnvelope } from "../policy.js";

import { stableActionId } from "./tool-action-id.js";

export { filesystemReadAction } from "./filesystem-read-policy-actions.js";
export { gitReadAction } from "./git-read-policy-actions.js";
export { repositoryMetadataReadAction } from "./repository-metadata-policy-actions.js";

export function evidenceReadAction(input: {
  cwd: string;
  evidenceId: string;
}): ActionEnvelope {
  return {
    actionId: stableActionId("evidence.read", [input.cwd, input.evidenceId]),
    actionType: "evidence.read",
    resource: {
      type: "evidence",
      id: input.evidenceId
    },
    context: {
      cwd: input.cwd
    }
  };
}

export function workspaceFactsReadAction(input: {
  cwd: string;
  refresh: boolean;
}): ActionEnvelope {
  return {
    actionId: stableActionId("workspace.facts.read", [input.cwd, input.refresh]),
    actionType: "workspace.facts.read",
    resource: {
      type: "repository",
      id: input.cwd
    },
    context: {
      cwd: input.cwd
    }
  };
}
