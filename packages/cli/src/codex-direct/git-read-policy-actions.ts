import type { ActionEnvelope } from "../policy.js";

import { stableActionId } from "./tool-action-id.js";

export function gitReadAction(input: {
  cwd: string;
  actionType: "git.status" | "git.diff" | "git.log" | "git.show" | "git.diff.summary";
}): ActionEnvelope {
  return {
    actionId: stableActionId(input.actionType, [input.cwd]),
    actionType: input.actionType,
    resource: {
      type: "repository",
      id: input.cwd
    },
    context: {
      cwd: input.cwd
    }
  };
}
