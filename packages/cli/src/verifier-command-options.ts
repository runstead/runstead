import type { CommandVerifierInput } from "./verifier-evidence.js";

export function parseVerifierCommandOption(value: string): CommandVerifierInput {
  const separator = value.indexOf("=");

  if (separator <= 0 || separator === value.length - 1) {
    throw new Error("--verifier must use name=command");
  }

  return {
    name: value.slice(0, separator).trim(),
    command: value.slice(separator + 1).trim()
  };
}

export function requireVerifierCommandOptions(
  values: string[],
  commandName: string
): CommandVerifierInput[] {
  const commands = values.map(parseVerifierCommandOption);

  if (commands.length === 0) {
    throw new Error(`${commandName} requires at least one --verifier name=command`);
  }

  return commands;
}
