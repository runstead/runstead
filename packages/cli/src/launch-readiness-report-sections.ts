import type { RepoInspectionSnapshot } from "./inspection-evidence.js";
import type { LaunchReadinessReportData } from "./launch-readiness-data.js";
import {
  commandEvidenceGovernance,
  currentCommandEvidence,
  currentEvidenceRows
} from "./launch-readiness-evidence.js";
import { staleCommandEvidenceGaps } from "./launch-readiness-report-evidence-format.js";
import {
  formatPercent,
  type LaunchReadinessTrustSummary
} from "./launch-readiness-trust.js";
import {
  hasCompletedTask,
  hasEvidenceType,
  indentList,
  listOrNone
} from "./launch-readiness-report-helpers.js";
import type { LaunchReadinessTarget } from "./launch-readiness-types.js";

export function repoHealth(
  repo: RepoInspectionSnapshot,
  target: LaunchReadinessTarget
): string {
  const packageManager = repo.packageManager.detected
    ? `${repo.packageManager.packageManager} (${repo.packageManager.source})`
    : "not detected";
  const testCommand = repo.commands.test.detected
    ? repo.commands.test.command
    : "missing";
  const lintCommand = repo.commands.lint.detected
    ? repo.commands.lint.command
    : "missing";
  const typecheckCommand = repo.commands.typecheck.detected
    ? repo.commands.typecheck.command
    : "missing";
  const buildCommand = repo.commands.build.detected
    ? repo.commands.build.command
    : "missing";
  const ci = repo.ci.detected
    ? repo.ci.providers.map((provider) => provider.provider).join(", ")
    : target === "local"
      ? "not required for local target"
      : "missing";

  return [
    `- Git: ${repo.git.isGitRepo ? "detected" : "not detected"}`,
    `- Branch: ${repo.git.branch ?? "unknown"}`,
    `- Package manager: ${packageManager}`,
    `- Test command: ${testCommand}`,
    `- Lint command: ${lintCommand}`,
    `- Typecheck command: ${typecheckCommand}`,
    `- Build command: ${buildCommand}`,
    `- CI: ${ci}`
  ].join("\n");
}

export function nextTargetBlockers(
  data: LaunchReadinessReportData,
  target: LaunchReadinessTarget
): string {
  if (target !== "local") {
    return "none";
  }

  const blockers = [
    ...(data.repo.ci.detected
      ? []
      : ["CI configuration is missing before staging or production readiness"])
  ];

  return listOrNone(blockers, (blocker) => `- ${blocker}`);
}

export function trustSummaryMarkdown(
  summary: LaunchReadinessTrustSummary,
  target: LaunchReadinessTarget
): string {
  return [
    `- Quality score (${target} target): ${formatPercent(summary.qualityScore)}`,
    `- Evidence completeness (${target} target): ${formatPercent(summary.evidenceCompletenessScore)}`,
    `- Conclusion: ${summary.conclusion}`,
    `- Remediation effort: ${summary.remediationEffort}`,
    `- Trend: blocker_delta=${summary.trend.blockerDelta}, previous_status=${summary.trend.previousStatus ?? "none"}`,
    "- Accepted debt register:",
    indentList(summary.acceptedDebtRegister),
    "- Audit export:",
    `  - schemaVersion=${summary.auditExport.schemaVersion}`,
    `  - evidenceRecords=${summary.auditExport.evidenceRecords}`,
    `  - staleEvidenceRecords=${summary.auditExport.staleEvidenceRecords}`,
    `  - structuredArtifacts=${summary.auditExport.structuredArtifacts}`
  ].join("\n");
}

export function governanceBoundary(data: LaunchReadinessReportData): string {
  const commandEvidence = currentCommandEvidence(data);

  return [
    "- Governance level: Level 1 wrapped execution for external workers; `codex_direct` is the hard-proxy path.",
    "- `codex_cli` and `claude_code` runs are policy-gated before launch, checkpointed, scope-verified after exit, and validated through verifier evidence.",
    "- Worker-internal tool calls from wrapped workers are not fully hard-proxied by Runstead.",
    "- Recommendation: use `codex_cli` for ecosystem compatibility; use `codex_direct` when every model tool call must pass through Runstead policy and audit.",
    ...(commandEvidence.length === 0
      ? ["- Command evidence governance: none recorded."]
      : [
          "- Command evidence governance:",
          ...commandEvidence.map(
            (item) => `  - ${item.id}: ${commandEvidenceGovernance(item)}`
          )
        ])
  ].join("\n");
}

export function testCoverageGaps(data: LaunchReadinessReportData): string {
  const gaps = [
    ...(data.repo.commands.test.detected ? [] : ["test command is missing"]),
    ...(data.repo.commands.lint.detected ? [] : ["lint command is missing"]),
    ...(data.repo.commands.typecheck.detected ? [] : ["typecheck command is missing"]),
    ...(data.repo.commands.build.detected ? [] : ["build command is missing"]),
    ...staleCommandEvidenceGaps(data),
    ...data.gate.warnings
  ];

  return listOrNone(gaps, (gap) => `- ${gap}`);
}

export function dependencyAndSecurityRisk(data: LaunchReadinessReportData): string {
  const pendingApprovals = data.approvals.filter(
    (approval) => approval.status === "pending"
  );
  const highRiskDecisions = data.policyDecisions.filter(
    (decision) => decision.risk === "high" || decision.risk === "critical"
  );
  const risks = [
    ...(data.protectedPathChanges.length === 0
      ? []
      : [`protected path changes: ${data.protectedPathChanges.join(", ")}`]),
    ...(pendingApprovals.length === 0
      ? []
      : [`pending approvals: ${pendingApprovals.map((item) => item.id).join(", ")}`]),
    ...(highRiskDecisions.length === 0
      ? []
      : [
          `recent high-risk policy decisions: ${highRiskDecisions
            .map((item) => item.id)
            .join(", ")}`
        ])
  ];

  return listOrNone(risks, (risk) => `- ${risk}`);
}

export function architecturalDebt(data: LaunchReadinessReportData): string {
  const debtEvidence = currentEvidenceRows(data).filter(
    (item) => item.type === "startup_accepted_debt" || item.type === "startup_debt"
  );

  if (debtEvidence.length === 0) {
    return "- no accepted debt evidence recorded";
  }

  return debtEvidence
    .map((item) => `- ${item.id}: ${item.summary ?? item.uri}`)
    .join("\n");
}

export function missingObservability(data: LaunchReadinessReportData): string {
  const currentEvidence = currentEvidenceRows(data);
  const measurementPresent =
    hasEvidenceType(currentEvidence, "startup_measurement_framework") ||
    hasCompletedTask(data.tasks, "define_measurement_framework");
  const metricPresent =
    hasEvidenceType(currentEvidence, "startup_metric") ||
    hasEvidenceType(currentEvidence, "startup_observability");
  const rows = [
    measurementPresent
      ? "measurement framework evidence present"
      : "measurement framework evidence is missing",
    metricPresent
      ? "metric or observability evidence present"
      : "metric or observability evidence is missing"
  ];

  return rows.map((row) => `- ${row}`).join("\n");
}

export function structuredStartupArtifacts(data: LaunchReadinessReportData): string {
  return listOrNone(
    data.structuredArtifacts,
    (item) =>
      `- ${item.kind}: ${item.id} (schemaVersion=${item.schemaVersion}, evidenceRefs=${item.sourceEvidenceIds.length})`
  );
}

export function acceptableDebt(data: LaunchReadinessReportData): string {
  const acceptableDebtEvidence = currentEvidenceRows(data).filter(
    (item) => item.type === "startup_acceptable_debt"
  );

  return listOrNone(
    acceptableDebtEvidence,
    (item) => `- ${item.id}: ${item.summary ?? item.uri}`
  );
}

export function nextSprintPlan(blockers: string[]): string {
  if (blockers.length === 0) {
    return "- keep launch gates green and rerun readiness before release";
  }

  return blockers
    .slice(0, 5)
    .map((blocker) => `- remediate: ${blocker}`)
    .join("\n");
}
