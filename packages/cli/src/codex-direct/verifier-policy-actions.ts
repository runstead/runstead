import type { Task } from "@runstead/core";

import type { ActionEnvelope } from "../policy.js";
import type { CommandVerifierInput } from "../verifier-evidence.js";
import { stableActionId } from "./tool-action-id.js";

export function verifierRunAction(input: {
  task: Task;
  cwd: string;
  command: CommandVerifierInput;
}): ActionEnvelope {
  return {
    actionId: stableActionId("verifier.run", [
      input.task.id,
      input.command.name,
      input.command.command
    ]),
    actionType: "verifier.run",
    resource: {
      type: "verifier",
      id: input.command.name
    },
    context: {
      cwd: input.cwd,
      command: input.command.command,
      sideEffects: ["execute_process", "read_workspace"]
    }
  };
}
