import { RunsteadCliError } from "./cli-errors.js";

export type CliWorkerKind = "codex_cli" | "claude_code" | "codex_direct";

export function parseRequiredPositiveInteger(
  value: string,
  optionName: string
): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new RunsteadCliError(
      `${optionName} must be a positive integer`,
      `use ${optionName} 8`
    );
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new RunsteadCliError(
      `${optionName} must be a positive integer`,
      `use ${optionName} 8`
    );
  }

  return parsed;
}

export function parseCiRepairWorkerKind(value: string): CliWorkerKind {
  if (value === "codex_cli" || value === "claude_code" || value === "codex_direct") {
    return value;
  }

  throw new Error("--worker must be codex_cli, claude_code, or codex_direct");
}
