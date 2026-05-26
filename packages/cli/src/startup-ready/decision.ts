import {
  formatReadinessTargetBoundaryLines,
  nextReadinessAction,
  readinessTargetBoundary,
  type ReadinessEvidenceRequirement
} from "@runstead/runtime";

import {
  evaluateStartupVerdict,
  type StartupVerdictResult
} from "../startup-verdict.js";
import type {
  StartupReadinessEvidenceTier,
  StartupReadinessRun,
  StartupReadinessVerdict,
  StartupReadyTarget
} from "./types.js";

export function startupReadinessDecisionMatrix(run: StartupReadinessRun): {
  localDemo: StartupReadinessDecision;
  privateBeta: StartupReadinessDecision;
  publicLaunch: StartupReadinessDecision;
} {
  return {
    localDemo: startupReadinessDecision({
      surface: "local_demo",
      title: "Local demo",
      target: "local",
      run
    }),
    privateBeta: startupReadinessDecision({
      surface: "private_beta",
      title: "Private beta / staging",
      target: "staging",
      run
    }),
    publicLaunch: startupReadinessDecision({
      surface: "public_launch",
      title: "Public launch",
      target: "production",
      run
    })
  };
}

export interface StartupReadinessDecision {
  surface: "local_demo" | "private_beta" | "public_launch";
  title: string;
  target: StartupReadyTarget;
  canLaunch: boolean;
  verdict: StartupReadinessVerdict;
  blockers: string[];
  nextAction: string;
}

export function startupReadinessDecision(input: {
  surface: StartupReadinessDecision["surface"];
  title: string;
  target: StartupReadyTarget;
  run: StartupReadinessRun;
}): StartupReadinessDecision {
  const evaluated = evaluateStartupReadinessVerdict({
    run: {
      target: input.target,
      phases: input.run.phases
    },
    evidenceTiers: input.run.evidenceTiers,
    evidenceTypes: input.run.evidenceTypes,
    evidenceRequirements: input.run.evidenceRequirements,
    staleEvidenceRefs: input.run.staleEvidenceRefs,
    supersededEvidenceRefs: input.run.supersededEvidenceRefs
  });

  return {
    surface: input.surface,
    title: input.title,
    target: input.target,
    canLaunch: evaluated.blockers.length === 0,
    verdict: evaluated.verdict,
    blockers: evaluated.blockers,
    nextAction:
      evaluated.blockers.length === 0
        ? `launch target ${input.target} with recorded evidence`
        : nextStartupReadinessAction(evaluated.blockers)
  };
}

export interface StartupReadinessTargetBoundary {
  requestedTarget: StartupReadyTarget;
  boundary: string;
  allowedUse: string;
  notEvidenceFor: string[];
  requiredNextEvidence: string[];
}

export function startupReadinessTargetBoundary(
  target: StartupReadyTarget
): StartupReadinessTargetBoundary {
  return readinessTargetBoundary(target);
}

export function formatStartupReadinessTargetBoundaryLines(
  boundary: StartupReadinessTargetBoundary
): string[] {
  return formatReadinessTargetBoundaryLines(boundary);
}

export function nextStartupReadinessAction(blockers: string[]): string {
  return nextReadinessAction(blockers);
}

export function evaluateStartupReadinessVerdict(input: {
  run: Pick<StartupReadinessRun, "target" | "phases">;
  evidenceTiers: StartupReadinessEvidenceTier[];
  evidenceTypes?: string[];
  evidenceRequirements?: ReadinessEvidenceRequirement[];
  staleEvidenceRefs?: string[];
  supersededEvidenceRefs?: string[];
}): StartupVerdictResult {
  return evaluateStartupVerdict({
    target: input.run.target,
    phases: input.run.phases,
    evidenceTiers: input.evidenceTiers,
    evidenceTypes: input.evidenceTypes ?? [],
    evidenceRequirements: input.evidenceRequirements ?? [],
    staleEvidenceRefs: input.staleEvidenceRefs ?? [],
    supersededEvidenceRefs: input.supersededEvidenceRefs ?? []
  });
}
