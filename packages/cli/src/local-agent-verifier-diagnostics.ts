import type { JsonObject } from "@runstead/core";

import type { LocalAgentDiagnostic } from "./local-agent-diagnostic-types.js";
import {
  isFailedVerifierOutput,
  outputString,
  stringOutput
} from "./local-agent-diagnostic-output.js";
import type { RunTaskVerifierCommandResult } from "./verifier-runner.js";

export function verifierDiagnostic(
  results: RunTaskVerifierCommandResult[] | undefined
): LocalAgentDiagnostic | undefined {
  const failed = results?.find((result) => result.exitCode !== 0 || result.timedOut);

  return failed === undefined
    ? undefined
    : {
        cause: `verifier failed: ${failed.verifier} exit=${failed.exitCode ?? "unknown"} evidence=${failed.evidenceId}`,
        likelyReason: "The model completed, but Runstead verification did not pass.",
        retry: `inspect evidence ${failed.evidenceId}, fix the failure, then rerun the verifier`
      };
}

export function verifierOutputDiagnostic(
  output: JsonObject
): LocalAgentDiagnostic | undefined {
  if (stringOutput(output, "verifierStatus") !== "failed") {
    return undefined;
  }

  const verifiers: unknown = output.verifiers;
  const failed = Array.isArray(verifiers)
    ? verifiers.find(isFailedVerifierOutput)
    : undefined;

  if (failed === undefined) {
    return {
      cause: "verifier failed",
      likelyReason: "The model completed, but Runstead verification did not pass."
    };
  }

  const exitCode = outputString(failed.exitCode, "unknown");
  const evidenceId = outputString(failed.evidenceId, "unknown");

  return {
    cause: `verifier failed: ${failed.verifier} exit=${exitCode} evidence=${evidenceId}`,
    likelyReason: "The model completed, but Runstead verification did not pass.",
    retry: `inspect evidence ${evidenceId}`
  };
}
