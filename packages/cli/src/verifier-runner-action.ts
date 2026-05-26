import { createHash } from "node:crypto";

import type { Task } from "@runstead/core";
import type { CommandVerifierInput } from "@runstead/verifiers";

import type { ActionEnvelope } from "./policy.js";

export function shellVerifierAction(input: {
  task: Task;
  command: CommandVerifierInput;
  index: number;
  cwd: string;
}): ActionEnvelope {
  return {
    actionId: verifierActionId(input),
    actionType: "shell.exec",
    resource: {
      type: "repository",
      path: input.cwd
    },
    context: {
      cwd: input.cwd,
      command: input.command.command
    }
  };
}

function verifierActionId(input: {
  task: Task;
  command: CommandVerifierInput;
  index: number;
}): string {
  const hash = createHash("sha256").update(input.command.command).digest("hex");
  const verifier = input.command.name.replace(/[^a-zA-Z0-9_]+/g, "_");

  return `act_${input.task.id}_${input.index}_${verifier}_${hash.slice(0, 12)}`;
}
