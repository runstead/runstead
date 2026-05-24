import {
  compileReadinessPlan,
  evaluateCompiledReadinessPlan,
  readinessVerdictReady,
  type ReadinessEvidenceRequirement,
  type ReadinessEvidenceTier,
  type ReadinessPlanPhase,
  type ReadinessTarget,
  type ReadinessVerdict,
  type ReadinessVerdictDecision,
  type ReadinessVerdictResult
} from "@runstead/runtime";

export type StartupVerdictTarget = ReadinessTarget;
export type StartupVerdict = ReadinessVerdict;
export type StartupVerdictEvidenceTier = ReadinessEvidenceTier;
export type StartupVerdictPhase = ReadinessPlanPhase;

export interface StartupVerdictInput {
  target: StartupVerdictTarget;
  phases: StartupVerdictPhase[];
  evidenceTiers: string[];
  evidenceTypes?: string[];
  staleEvidenceRefs?: string[];
  supersededEvidenceRefs?: string[];
  evidenceRequirements?: ReadinessEvidenceRequirement[];
}

export type StartupVerdictDecision = ReadinessVerdictDecision;
export type StartupVerdictResult = ReadinessVerdictResult;

export function evaluateStartupVerdict(
  input: StartupVerdictInput
): StartupVerdictResult {
  return evaluateCompiledReadinessPlan(compileReadinessPlan(input));
}

export function evaluateStartupTargetVerdict(
  input: StartupVerdictInput
): StartupVerdictDecision {
  return evaluateStartupVerdict(input).targetReadiness[input.target];
}

export function startupVerdictReady(verdict: string): boolean {
  return readinessVerdictReady(verdict);
}
