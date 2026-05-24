import type { ReadinessEvidenceRequirement } from "@runstead/runtime";

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
  if (target === "local") {
    return {
      requestedTarget: target,
      boundary:
        "local_launch_ready covers local demo and local operator validation only; it is not public launch clearance.",
      allowedUse:
        "Use this verdict for founder demos, local QA, and deciding whether the MVP is ready for a private staging run.",
      notEvidenceFor: [
        "public traffic",
        "production deployment safety",
        "CI-backed regression protection",
        "real-user analytics",
        "support or incident readiness"
      ],
      requiredNextEvidence: [
        "CI summary artifact",
        "staging deployment evidence",
        "rollback drill, migration validation, and monitoring alert evidence from the deployment target",
        "real-user analytics or support triage evidence before production"
      ]
    };
  }

  if (target === "staging") {
    return {
      requestedTarget: target,
      boundary:
        "staging_launch_ready covers private beta or staging rollout only; it is not production launch clearance.",
      allowedUse:
        "Use this verdict for controlled beta testers, staging release candidates, and pre-production signoff.",
      notEvidenceFor: [
        "unrestricted public launch",
        "production incident response readiness",
        "production real-user analytics"
      ],
      requiredNextEvidence: [
        "production deployment evidence",
        "production rollback drill",
        "production monitoring alerts, error budget, and migration validation",
        "real-user traffic gate, analytics, support triage, and post-launch watch evidence"
      ]
    };
  }

  return {
    requestedTarget: target,
    boundary:
      "public_launch_ready is the only Runstead readiness verdict that claims production/public launch clearance.",
    allowedUse:
      "Use this verdict only when CI, deployment, rollback drill, monitoring alerts, error budget, migration validation, traffic gate, real-user, support, and post-launch watch evidence are all current.",
    notEvidenceFor: [
      "ongoing scale safety after launch",
      "compliance certification beyond the recorded evidence",
      "future product changes without fresh verification"
    ],
    requiredNextEvidence: [
      "post-launch monitoring review",
      "traffic gate and error budget review",
      "support ticket and feedback triage",
      "scale readiness evidence before delegation or growth spend"
    ]
  };
}

export function formatStartupReadinessTargetBoundaryLines(
  boundary: StartupReadinessTargetBoundary
): string[] {
  return [
    `- Requested target: ${boundary.requestedTarget}`,
    `- Boundary: ${boundary.boundary}`,
    `- Allowed use: ${boundary.allowedUse}`,
    `- Not evidence for: ${boundary.notEvidenceFor.join("; ")}`,
    `- Required next evidence: ${boundary.requiredNextEvidence.join("; ")}`
  ];
}

export function nextStartupReadinessAction(blockers: string[]): string {
  const blocker = blockers[0];

  if (blocker === undefined) {
    return "continue launch readiness";
  }

  if (blocker.includes("CI")) {
    return "run startup ready in CI and attach CI summary evidence";
  }

  if (blocker.includes("deployment")) {
    return "attach deployment evidence for the requested target";
  }

  if (blocker.includes("analytics")) {
    return "record a real-user analytics metric snapshot";
  }

  if (blocker.includes("rollback")) {
    return "record rollback-plan evidence";
  }

  if (blocker.includes("observability")) {
    return "record observability evidence";
  }

  return blocker;
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
