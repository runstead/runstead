import type { StartupReadinessEvidenceRow } from "./evidence.js";
import { isRecord, stringValue } from "./shared.js";

export interface CurrentStartupReadyVerifierEvidenceMatch {
  verifier: string;
  evidenceId: string;
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  forceKilled: boolean;
  createdAt: string;
}

export function currentStartupReadyVerifierEvidenceMatch(input: {
  row: StartupReadinessEvidenceRow;
  artifact: unknown;
  expected: Set<string>;
  codeFingerprint: string;
}): CurrentStartupReadyVerifierEvidenceMatch | undefined {
  if (!isRecord(input.artifact)) {
    return undefined;
  }

  const verifier = stringValue(input.artifact.verifier);

  if (verifier === undefined || !input.expected.has(verifier)) {
    return undefined;
  }

  const codeState = input.artifact.codeState;

  if (
    !isRecord(codeState) ||
    stringValue(codeState.fingerprint) !== input.codeFingerprint
  ) {
    return undefined;
  }

  const result = input.artifact.result;

  if (!isRecord(result)) {
    return undefined;
  }

  const exitCode =
    typeof result.exitCode === "number"
      ? result.exitCode
      : result.exitCode === null
        ? null
        : undefined;

  if (exitCode === undefined || typeof result.timedOut !== "boolean") {
    return undefined;
  }

  return {
    verifier,
    evidenceId: input.row.id,
    command: stringValue(input.artifact.command) ?? "",
    exitCode,
    timedOut: result.timedOut,
    forceKilled: result.forceKilled === true,
    createdAt: input.row.createdAt
  };
}
