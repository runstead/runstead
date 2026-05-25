import type { StartupGateStage } from "./startup-evidence-types.js";

export type StartupGateFindingSeverity = "critical" | "major" | "minor" | "warning";

export interface StartupGateRule {
  id: string;
  stage: StartupGateStage;
  severity: StartupGateFindingSeverity;
  blocker: string;
  explanation: string;
  remediationTask: string;
}

export const STARTUP_GATE_RULES: StartupGateRule[] = [
  gateRule("mvp", "problem hypothesis is missing", "major"),
  gateRule("mvp", "user hypothesis is missing", "major"),
  gateRule("mvp", "solution hypothesis is missing", "major"),
  gateRule(
    "mvp",
    "customer, competitor, or metric validation evidence is missing",
    "critical"
  ),
  gateRule("mvp", "disconfirming evidence is missing", "major"),
  gateRule("launch", "measurement framework is missing", "critical"),
  gateRule(
    "launch",
    "metric snapshot with source, threshold, and current value is missing",
    "critical"
  ),
  gateRule("launch", "repo readiness audit is missing", "major"),
  gateRule("launch", "security baseline is missing", "critical"),
  gateRule("launch", "passing verifier command evidence is missing", "critical"),
  gateRule("launch", "migration plan evidence is missing", "major"),
  gateRule("launch", "rollback plan evidence is missing", "major"),
  gateRule("launch", "observability evidence is missing", "major"),
  gateRule("launch", "founder bottleneck audit is missing", "major"),
  gateRule("scale", "founder bottleneck map is missing", "major"),
  gateRule("scale", "workflow registry is missing", "major"),
  gateRule("scale", "delegation policy is missing", "major"),
  gateRule("scale", "institutional memory evidence is missing", "major"),
  gateRule("scale", "scale report schedule is missing", "minor"),
  gateRule("scale", "recurring ops report is missing", "minor"),
  gateRule("scale", "integration depth map is missing", "major"),
  gateRule("scale", "ops SOP evidence is missing", "major"),
  gateRule("scale", "support triage evidence is missing", "minor"),
  gateRule("scale", "GTM artifact verification is missing", "major")
];

export function startupGateRuleForBlocker(
  stage: StartupGateStage,
  blocker: string
): StartupGateRule | undefined {
  return STARTUP_GATE_RULES.find(
    (rule) => rule.stage === stage && rule.blocker === blocker
  );
}

export function stableGateFindingId(stage: StartupGateStage, blocker: string): string {
  return `${stage}_${blocker
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}`;
}

export function inferGateFindingSeverity(blocker: string): StartupGateFindingSeverity {
  const lowered = blocker.toLowerCase();

  if (
    lowered.includes("security") ||
    lowered.includes("verifier") ||
    lowered.includes("measurement") ||
    lowered.includes("validation evidence")
  ) {
    return "critical";
  }

  if (
    lowered.includes("missing") ||
    lowered.includes("failed") ||
    lowered.includes("overdue") ||
    lowered.includes("requires")
  ) {
    return "major";
  }

  return "minor";
}

export function explainGateBlocker(blocker: string): string {
  return `Runstead cannot clear this gate until this requirement is backed by current evidence: ${blocker}`;
}

export function remediationTaskForBlocker(blocker: string): string {
  if (blocker.includes("measurement")) return "record startup measurement evidence";
  if (blocker.includes("metric"))
    return "record a metric snapshot with source and threshold";
  if (blocker.includes("security")) return "run startup launch security-baseline";
  if (blocker.includes("repo readiness")) return "run startup launch audit";
  if (blocker.includes("verifier"))
    return "run MVP verifier commands and record evidence";
  if (blocker.includes("migration")) return "record migration plan evidence";
  if (blocker.includes("rollback")) return "record rollback plan evidence";
  if (blocker.includes("observability")) return "record observability evidence";
  if (blocker.includes("bottleneck")) return "run startup launch bottleneck-map";
  if (blocker.includes("hypothesis")) return "validate startup hypothesis evidence";

  return "record evidence or execute remediation for this blocker";
}

function gateRule(
  stage: StartupGateStage,
  blocker: string,
  severity: StartupGateFindingSeverity
): StartupGateRule {
  return {
    id: stableGateFindingId(stage, blocker),
    stage,
    severity,
    blocker,
    explanation: explainGateBlocker(blocker),
    remediationTask: remediationTaskForBlocker(blocker)
  };
}
