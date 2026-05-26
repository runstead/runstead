import type { JsonObject } from "@runstead/core";
import type { CommandVerifierInput, CommandVerifierResult } from "@runstead/verifiers";

import type { StoreCommandVerifierEvidenceResult } from "./verifier-evidence.js";

export function verifierOutput(
  commandResults: CommandVerifierResult[],
  passed: boolean
): JsonObject {
  return {
    summary: passed
      ? "All verifier commands passed"
      : commandResults.length === 0
        ? "No verifier commands configured"
        : "One or more verifier commands failed",
    commands: commandResults
  };
}

export function policyCommandResult(
  command: CommandVerifierInput,
  evidenceResult: StoreCommandVerifierEvidenceResult,
  policyDecisionId: string,
  approvalId?: string
): CommandVerifierResult {
  return {
    verifier: command.name,
    exitCode: null,
    timedOut: false,
    forceKilled: false,
    evidenceId: evidenceResult.evidence.id,
    policyDecisionId,
    ...(approvalId === undefined ? {} : { approvalId })
  };
}
