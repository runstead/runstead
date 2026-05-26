import type { RepoInspectionSnapshot } from "./inspection-evidence.js";
import type {
  EvidenceReportRow,
  LaunchReadinessReportData
} from "./launch-readiness-data.js";
import {
  commandEvidenceCodeState,
  commandEvidenceGovernance,
  currentCommandEvidence,
  currentEvidenceRows,
  evidenceSourceSummary,
  formatCurrentCodeFingerprint,
  isStaleCommandEvidence,
  parsedEvidenceContent,
  staleCommandEvidence,
  staleEvidenceReason,
  staleEvidenceReasonGroupLabel,
  staleEvidenceReasonGroups,
  staleEvidenceRows
} from "./launch-readiness-evidence.js";
import {
  formatPercent,
  formatScore,
  type LaunchReadinessStatus,
  type LaunchReadinessTrustSummary
} from "./launch-readiness-trust.js";
import {
  formatTaskCounts,
  hasCompletedTask,
  hasEvidenceType,
  indentList,
  isRecord,
  listOrNone,
  stringArrayValue,
  stringValue
} from "./launch-readiness-report-helpers.js";
import { blockerSource, riskRegister } from "./launch-readiness-risk-format.js";
import type {
  LaunchReadinessTarget,
  LaunchReadinessTargetStatus
} from "./launch-readiness-types.js";

const STALE_EVIDENCE_APPENDIX_LIMIT = 10;

export function formatLaunchReadinessReport(input: {
  generatedAt: string;
  domain: string;
  target: LaunchReadinessTarget;
  status: LaunchReadinessStatus;
  targetStatus: LaunchReadinessTargetStatus;
  blockers: string[];
  trustSummary: LaunchReadinessTrustSummary;
  data: LaunchReadinessReportData;
}): string {
  return [
    "# Runstead Launch Readiness Report",
    "",
    `Domain: ${input.domain}`,
    `Target: ${input.target}`,
    `Generated: ${input.generatedAt}`,
    `Status: ${input.targetStatus}`,
    "",
    "## Trust Summary",
    "",
    trustSummaryMarkdown(input.trustSummary, input.target),
    "",
    "## Evidence Freshness Summary",
    "",
    staleEvidenceSummary(input.data),
    "",
    "## Metric Evidence Confidence",
    "",
    metricEvidenceConfidence(input.data),
    "",
    "## Repo Health",
    "",
    repoHealth(input.data.repo, input.target),
    "",
    "## Next Target Blockers",
    "",
    nextTargetBlockers(input.data, input.target),
    "",
    "## Verifier Status",
    "",
    verifierStatus(input.data),
    "",
    "## Governance Boundary",
    "",
    governanceBoundary(input.data),
    "",
    "## Test Coverage Gaps",
    "",
    testCoverageGaps(input.data),
    "",
    "## Dependency And Security Risk",
    "",
    dependencyAndSecurityRisk(input.data),
    "",
    "## Protected Path Changes",
    "",
    listOrNone(input.data.protectedPathChanges, (path) => `- ${path}`),
    "",
    "## Architectural Debt",
    "",
    architecturalDebt(input.data),
    "",
    "## Missing Observability",
    "",
    missingObservability(input.data),
    "",
    "## Frontend UI Validation",
    "",
    frontendUiValidation(input.data),
    "",
    "## Structured Startup Artifacts",
    "",
    structuredStartupArtifacts(input.data),
    "",
    "## Evidence Provenance",
    "",
    evidenceProvenance(input.data),
    "",
    "## Change Authorship",
    "",
    changeAuthorship(input.data),
    "",
    "## Stale Evidence Appendix",
    "",
    staleEvidenceAppendix(input.data),
    "",
    "## Release Blockers",
    "",
    listOrNone(
      input.blockers,
      (blocker) => `- ${blocker} [source: ${blockerSource(input.data, blocker)}]`
    ),
    "",
    "## Risk Register",
    "",
    riskRegister(input.data, input.blockers),
    "",
    "## Acceptable Debt",
    "",
    acceptableDebt(input.data),
    "",
    "## Next Sprint Remediation Plan",
    "",
    nextSprintPlan(input.blockers),
    ""
  ].join("\n");
}

function repoHealth(
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

function nextTargetBlockers(
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

function trustSummaryMarkdown(
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

function metricEvidenceConfidence(data: LaunchReadinessReportData): string {
  const metricEvidence = currentEvidenceRows(data).filter(
    (item) => item.type === "startup_metric_snapshot"
  );

  return listOrNone(metricEvidence, (item) => {
    const content = parsedEvidenceContent(item.uri);

    if (!isRecord(content)) {
      return `- ${item.id}: source_class=missing confidence=unknown launch_weight=unknown`;
    }

    const sourceClass = stringValue(content.sourceClass) ?? "founder_manual";
    const confidence =
      typeof content.confidence === "number"
        ? formatScore(content.confidence)
        : "unknown";
    const launchWeight =
      typeof content.launchWeight === "number"
        ? formatScore(content.launchWeight)
        : "unknown";
    const realUserData =
      typeof content.realUserData === "boolean"
        ? content.realUserData
          ? "yes"
          : "no"
        : "unknown";

    return [
      `- ${item.id}: metric=${stringValue(content.metric) ?? "unknown"}`,
      `source_class=${sourceClass}`,
      `confidence=${confidence}`,
      `launch_weight=${launchWeight}`,
      `real_user_data=${realUserData}`
    ].join(" ");
  });
}

function verifierStatus(data: LaunchReadinessReportData): string {
  const verifierTasks = data.tasks.filter(
    (task) => task.type === "run_mvp_verifiers" || task.type === "run_local_verifiers"
  );
  const commandEvidence = currentCommandEvidence(data);
  const staleEvidence = staleCommandEvidence(data);

  return [
    `- Verifier tasks: ${formatTaskCounts(verifierTasks)}`,
    `- Current code fingerprint: ${formatCurrentCodeFingerprint(data.currentCodeState)}`,
    `- Current command evidence records: ${commandEvidence.length}`,
    `- Stale command evidence records: ${staleEvidence.length} (see appendix)`,
    ...commandEvidence.map(
      (item) =>
        `- ${item.id}: ${item.summary ?? item.uri} (${item.created_at}; ${commandEvidenceGovernance(item)}; ${commandEvidenceCodeState(data, item)})`
    )
  ].join("\n");
}

function staleEvidenceSummary(data: LaunchReadinessReportData): string {
  const current = currentEvidenceRows(data).length;
  const stale = staleEvidenceRows(data).length;
  const groups = staleEvidenceReasonGroups(data);

  if (stale === 0) {
    return [
      `- Current evidence records: ${current}`,
      "- Stale/superseded evidence records: 0"
    ].join("\n");
  }

  return [
    `- Current evidence records: ${current}`,
    `- Stale/superseded evidence records: ${stale}`,
    ...groups.map(
      (group) => `- ${staleEvidenceReasonGroupLabel(group.reason)}: ${group.count}`
    ),
    "- Full stale evidence remains in the JSON artifact and stale evidence appendix."
  ].join("\n");
}

function governanceBoundary(data: LaunchReadinessReportData): string {
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

function testCoverageGaps(data: LaunchReadinessReportData): string {
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

function staleCommandEvidenceGaps(data: LaunchReadinessReportData): string[] {
  const stale = staleCommandEvidence(data);

  return stale.length === 0
    ? []
    : [
        `${stale.length} verifier evidence record${stale.length === 1 ? "" : "s"} recorded against stale code state; see stale evidence appendix`
      ];
}

function dependencyAndSecurityRisk(data: LaunchReadinessReportData): string {
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

function architecturalDebt(data: LaunchReadinessReportData): string {
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

function missingObservability(data: LaunchReadinessReportData): string {
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

function frontendUiValidation(data: LaunchReadinessReportData): string {
  const rows = currentEvidenceRows(data).filter(
    (item) => item.type === "startup_ui_validation"
  );

  return listOrNone(rows, (item) => {
    const content = parsedEvidenceContent(item.uri);

    if (!isRecord(content)) {
      return `- ${item.id}: ${item.summary ?? item.uri}`;
    }

    return [
      `- ${item.id}: url=${stringValue(content.url) ?? "unknown"}`,
      `viewport=${stringValue(content.viewport) ?? "unknown"}`,
      `dom=${stringValue(content.domStatus) ?? "unknown"}`,
      `accessibility=${stringValue(content.accessibilityStatus) ?? "unknown"}`,
      `responsive=${stringValue(content.responsiveStatus) ?? "unknown"}`,
      `flow=${stringValue(content.criticalFlowStatus) ?? "unknown"}`
    ].join(" ");
  });
}

function structuredStartupArtifacts(data: LaunchReadinessReportData): string {
  return listOrNone(
    data.structuredArtifacts,
    (item) =>
      `- ${item.kind}: ${item.id} (schemaVersion=${item.schemaVersion}, evidenceRefs=${item.sourceEvidenceIds.length})`
  );
}

function evidenceProvenance(data: LaunchReadinessReportData): string {
  const rows = currentEvidenceRows(data).filter(
    (item) =>
      (item.type === "command_output" && !isStaleCommandEvidence(data, item)) ||
      item.type.startsWith("startup_")
  );

  return listOrNone(rows, (item) => `- ${item.id}: ${evidenceSourceSummary(item)}`);
}

function changeAuthorship(data: LaunchReadinessReportData): string {
  const currentEvidence = currentEvidenceRows(data);
  const operatorChanges = currentEvidence.filter(
    (item) => item.type === "startup_manual_change"
  );
  const agentEvidence = currentEvidence.filter(
    (item) =>
      item.type === "command_output" ||
      item.task_type === "local_agent_task" ||
      item.summary?.toLowerCase().includes("codex") === true
  );

  return [
    `- Agent change evidence: ${agentEvidence.length}`,
    `- Operator change evidence: ${operatorChanges.length}`,
    ...operatorChanges.map((item) => `- Operator: ${manualChangeSummary(item)}`)
  ].join("\n");
}

function manualChangeSummary(item: EvidenceReportRow): string {
  const content = parsedEvidenceContent(item.uri);

  if (!isRecord(content)) {
    return `${item.id}: ${item.summary ?? item.uri}`;
  }

  const actor = stringValue(content.actor) ?? "unknown";
  const reason = stringValue(content.reason) ?? "unspecified";
  const diffSummary = stringValue(content.diffSummary) ?? item.summary ?? "change";
  const commands = stringArrayValue(content.commandsRerun);
  const evidenceRefs = stringArrayValue(content.evidenceRefs);

  return [
    `${item.id}: actor=${actor}`,
    `diff="${diffSummary}"`,
    `reason="${reason}"`,
    `commands=${commands.length === 0 ? "none" : commands.join(",")}`,
    `evidenceRefs=${evidenceRefs.length === 0 ? "none" : evidenceRefs.join(",")}`
  ].join(" ");
}

function staleEvidenceAppendix(data: LaunchReadinessReportData): string {
  const rows = staleEvidenceRows(data);
  const visibleRows = rows.slice(0, STALE_EVIDENCE_APPENDIX_LIMIT);
  const omitted = rows.length - visibleRows.length;

  if (rows.length === 0) {
    return "none";
  }

  return [
    `- Total stale records: ${rows.length}; showing ${visibleRows.length}. Full stale evidence remains in the JSON artifact.`,
    ...visibleRows.map(
      (item) =>
        `- ${item.id}: ${item.summary ?? item.uri} (${staleEvidenceReason(data, item)}; ${evidenceSourceSummary(item)})`
    ),
    ...(omitted === 0
      ? []
      : [
          `- ${omitted} additional stale evidence record${omitted === 1 ? "" : "s"} omitted from markdown; inspect staleEvidence in the JSON artifact.`
        ])
  ].join("\n");
}

function acceptableDebt(data: LaunchReadinessReportData): string {
  const acceptableDebtEvidence = currentEvidenceRows(data).filter(
    (item) => item.type === "startup_acceptable_debt"
  );

  return listOrNone(
    acceptableDebtEvidence,
    (item) => `- ${item.id}: ${item.summary ?? item.uri}`
  );
}

function nextSprintPlan(blockers: string[]): string {
  if (blockers.length === 0) {
    return "- keep launch gates green and rerun readiness before release";
  }

  return blockers
    .slice(0, 5)
    .map((blocker) => `- remediate: ${blocker}`)
    .join("\n");
}
