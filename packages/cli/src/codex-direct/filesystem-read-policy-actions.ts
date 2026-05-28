import type { ActionEnvelope } from "../policy.js";

import { stableActionId } from "./tool-action-id.js";

export function filesystemReadAction(input: {
  cwd: string;
  actionType:
    | "filesystem.list"
    | "filesystem.search"
    | "filesystem.read"
    | "filesystem.stat";
  path: string;
  filesTouched?: string[];
  stableParts: unknown[];
}): ActionEnvelope {
  return {
    actionId: stableActionId(input.actionType, input.stableParts),
    actionType: input.actionType,
    resource: {
      type: "directory",
      path: input.path
    },
    context: {
      cwd: input.cwd,
      ...(input.filesTouched === undefined ? {} : { filesTouched: input.filesTouched })
    }
  };
}
