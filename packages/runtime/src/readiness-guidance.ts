import type { ReadinessTarget } from "./readiness-plan.js";

export interface ReadinessTargetBoundary {
  requestedTarget: ReadinessTarget;
  boundary: string;
  allowedUse: string;
  notEvidenceFor: string[];
  requiredNextEvidence: string[];
}

export function readinessTargetBoundary(
  target: ReadinessTarget
): ReadinessTargetBoundary {
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

export function formatReadinessTargetBoundaryLines(
  boundary: ReadinessTargetBoundary
): string[] {
  return [
    `- Requested target: ${boundary.requestedTarget}`,
    `- Boundary: ${boundary.boundary}`,
    `- Allowed use: ${boundary.allowedUse}`,
    `- Not evidence for: ${boundary.notEvidenceFor.join("; ")}`,
    `- Required next evidence: ${boundary.requiredNextEvidence.join("; ")}`
  ];
}

export function nextReadinessAction(blockers: string[]): string {
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
