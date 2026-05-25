export const STARTUP_EVIDENCE_TYPES = [
  "customer_interview",
  "competitor",
  "metric",
  "metric_snapshot",
  "measurement_framework",
  "agent_context",
  "repo_readiness",
  "security_baseline",
  "migration_plan",
  "rollback_plan",
  "rollback_drill",
  "release_plan",
  "launch_git_path",
  "ui_validation",
  "hypothesis",
  "problem_hypothesis",
  "user_hypothesis",
  "solution_hypothesis",
  "disconfirming",
  "support_triage",
  "founder_bottleneck",
  "workflow_registry",
  "delegation_policy",
  "institutional_memory",
  "memory_retrieval",
  "ops_schedule",
  "ops_report",
  "integration_map",
  "ops_sop",
  "gtm_artifact",
  "scale_starter_pack",
  "decision",
  "acceptable_debt",
  "false_positive",
  "observability",
  "monitoring_alerts",
  "error_budget",
  "migration_validation",
  "traffic_gate",
  "post_launch_watch",
  "remediation_failure",
  "team_collaboration",
  "manual_change",
  "complete_product_check"
] as const;

export type StartupEvidenceType = (typeof STARTUP_EVIDENCE_TYPES)[number];
export type StartupHypothesisKind = "problem" | "user" | "solution";
export type StartupHypothesisStatus =
  | "open"
  | "validated"
  | "invalidated"
  | "needs-more-evidence";
export type StartupGateStage = "idea" | "mvp" | "launch" | "scale";

export function parseStartupEvidenceType(value: string): StartupEvidenceType {
  if (STARTUP_EVIDENCE_TYPES.includes(value as StartupEvidenceType)) {
    return value as StartupEvidenceType;
  }

  throw new Error(
    `Unsupported startup evidence type ${value}. Expected one of: ${STARTUP_EVIDENCE_TYPES.join(", ")}`
  );
}

export function validateStartupEvidenceContent(
  evidenceType: StartupEvidenceType,
  content: string | undefined
): void {
  if (evidenceType !== "metric_snapshot") {
    return;
  }

  const parsed = parseEvidenceContentJson(content, "metric_snapshot");

  if (
    !isRecord(parsed) ||
    !hasNonEmptyString(parsed.source) ||
    !hasNonEmptyValue(parsed.threshold) ||
    !hasNonEmptyValue(parsed.current)
  ) {
    throw new Error(
      "startup metric_snapshot evidence requires JSON content with source, threshold, and current. Prefer: runstead startup measurement snapshot --metric <name> --source <source> --threshold <value> --current <value>"
    );
  }
}

export function parseStartupHypothesisStatusValue(
  value: unknown
): StartupHypothesisStatus {
  if (
    value === "open" ||
    value === "validated" ||
    value === "invalidated" ||
    value === "needs-more-evidence"
  ) {
    return value;
  }

  return "open";
}

function parseEvidenceContentJson(
  content: string | undefined,
  evidenceType: string
): unknown {
  if (content === undefined || content.trim().length === 0) {
    throw new Error(
      `startup ${evidenceType} evidence requires JSON content. Prefer the typed startup measurement snapshot command.`
    );
  }

  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new Error(
      `startup ${evidenceType} evidence content must be valid JSON. Prefer the typed startup measurement snapshot command.`
    );
  }
}

function hasNonEmptyValue(value: unknown): boolean {
  return (
    hasNonEmptyString(value) ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
