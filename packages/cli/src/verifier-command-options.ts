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
