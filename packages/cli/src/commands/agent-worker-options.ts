import { parseCiRepairWorkerKind, type CliWorkerKind } from "../cli-parsers.js";

export const CODEX_DIRECT_AGENT_WORKERS = ["codex_direct"] as const;
export const ALL_LOCAL_AGENT_WORKERS = [
  "codex_direct",
  "codex_cli",
  "claude_code"
] as const;

export interface ParseAgentWorkerOptionInput {
  worker: string;
  supported: readonly CliWorkerKind[];
  unsupportedMessage: string;
}

export function parseAgentWorkerOption(
  input: ParseAgentWorkerOptionInput
): CliWorkerKind {
  const worker = parseCiRepairWorkerKind(input.worker);

  if (!input.supported.includes(worker)) {
    throw new Error(input.unsupportedMessage);
  }

  return worker;
}
