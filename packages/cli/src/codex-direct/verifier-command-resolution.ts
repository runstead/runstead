import type { Task } from "@runstead/core";

import { discoverVerifierCommands } from "../verifier-discovery.js";
import type { CommandVerifierInput } from "../verifier-evidence.js";
import { isRecord } from "./tool-arguments.js";
import type { CodexDirectWorkerOptions } from "./worker.js";

export async function resolveVerifierCommand(
  options: Pick<CodexDirectWorkerOptions, "cwd" | "task"> & { name: string }
): Promise<CommandVerifierInput> {
  const declared = declaredVerifierCommands(options.task);
  const discovered = await discoverVerifierCommands({ cwd: options.cwd });
  const candidates = [...declared, ...discovered];
  const command = candidates.find((candidate) => candidate.name === options.name);

  if (command === undefined) {
    throw new Error(
      `Verifier not available: ${options.name}. Available verifiers: ${
        candidates.map((candidate) => candidate.name).join(", ") || "none"
      }`
    );
  }

  return command;
}

export function declaredVerifierCommands(task: Task): CommandVerifierInput[] {
  const commands = task.input.commands;

  if (!Array.isArray(commands)) {
    return [];
  }

  return commands.flatMap((command) => {
    if (!isRecord(command)) {
      return [];
    }

    const name = command.name;
    const commandText = command.command;

    return typeof name === "string" && typeof commandText === "string"
      ? [{ name, command: commandText }]
      : [];
  });
}
