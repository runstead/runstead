import type { JsonObject } from "@runstead/core";

import type { RepoInspectionSnapshot } from "./inspection-evidence.js";
import type {
  EvidenceReportRow,
  LaunchReadinessReportData,
  TaskReportRow
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

function indentList(items: string[]): string {
  return items.map((item) => `  - ${item}`).join("\n");
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

function riskRegister(data: LaunchReadinessReportData, blockers: string[]): string {
  const rows = [
    ...blockers.map((blocker) => ({
      risk: blocker,
      source: riskSource(data, blocker),
      recommendedTask: recommendedTaskForRisk(blocker)
    })),
    ...missingEvidenceRows(data)
  ];

  if (rows.length === 0) {
    return "- no launch risks detected";
  }

  return rows
    .map(
      (row) =>
        `- Risk: ${row.risk}\n  Source: ${row.source}\n  Recommended task: ${row.recommendedTask}`
    )
    .join("\n");
}

function missingEvidenceRows(data: LaunchReadinessReportData): {
  risk: string;
  source: string;
  recommendedTask: string;
}[] {
  const currentEvidence = currentEvidenceRows(data);

  return [
    ...(hasEvidenceType(currentEvidence, "startup_repo_readiness")
      ? []
      : [
          {
            risk: "repo readiness evidence is not recorded",
            source: "evidence ledger",
            recommendedTask: "run startup launch audit"
          }
        ]),
    ...(hasEvidenceType(currentEvidence, "startup_security_baseline")
      ? []
      : [
          {
            risk: "security baseline evidence is not recorded",
            source: "evidence ledger",
            recommendedTask: "run startup launch security-baseline"
          }
        ])
  ];
}

function riskSource(data: LaunchReadinessReportData, risk: string): string {
  if (risk.startsWith("task ")) return blockerSource(data, risk);
  if (risk.includes("test command")) return "package.json scripts";
  if (risk.includes("lint command")) return "package.json scripts";
  if (risk.includes("typecheck command")) return "package.json scripts";
  if (risk.includes("build command")) return "package.json scripts";
  if (risk.includes("CI configuration")) return "repo inspection";
  if (risk.includes("verifier")) return evidenceSource(data, "command_output");
  if (risk.includes("measurement")) {
    return evidenceSource(data, "startup_measurement_framework");
  }
  if (risk.includes("repo readiness")) {
    return evidenceSource(data, "startup_repo_readiness");
  }
  if (risk.includes("security baseline")) {
    return evidenceSource(data, "startup_security_baseline");
  }
  if (risk.includes("migration")) return evidenceSource(data, "startup_migration_plan");
  if (risk.includes("rollback")) return evidenceSource(data, "startup_rollback_plan");
  if (risk.includes("observability")) {
    return evidenceSource(data, "startup_observability");
  }
  if (risk.includes("founder bottleneck")) {
    return evidenceSource(data, "startup_founder_bottleneck");
  }
  if (risk.includes("protected path")) return "git status protected path scan";
  if (risk.includes("approval")) return "approval ledger";

  return "launch readiness analysis";
}

function blockerSource(data: LaunchReadinessReportData, blocker: string): string {
  const taskMatch = /^task (?<id>\S+) \((?<type>[^)]+)\) is (?<status>\S+)/.exec(
    blocker
  );

  if (taskMatch?.groups !== undefined) {
    return `task:${taskMatch.groups.id} type=${taskMatch.groups.type} status=${taskMatch.groups.status}`;
  }

  if (blocker.startsWith("approval ")) {
    const approvalId = blocker.split(/\s+/)[1] ?? "unknown";

    return `approval:${approvalId}`;
  }

  if (data.gate.blockers.includes(blocker)) {
    return "phase:launch gate=startup_evidence";
  }

  if (blocker.includes("test command")) return "repo:package_json script=test";
  if (blocker.includes("lint command")) return "repo:package_json script=lint";
  if (blocker.includes("typecheck command")) {
    return "repo:package_json script=typecheck";
  }
  if (blocker.includes("build command")) return "repo:package_json script=build";
  if (blocker.includes("CI configuration")) return "repo:ci_detection";
  if (blocker.includes("protected path")) return "repo:git_status protected_path_scan";
  if (blocker.includes("verifier")) return evidenceSource(data, "command_output");
  if (blocker.includes("measurement")) {
    return evidenceSource(data, "startup_measurement_framework");
  }
  if (blocker.includes("repo readiness")) {
    return evidenceSource(data, "startup_repo_readiness");
  }
  if (blocker.includes("security baseline")) {
    return evidenceSource(data, "startup_security_baseline");
  }
  if (blocker.includes("migration"))
    return evidenceSource(data, "startup_migration_plan");
  if (blocker.includes("rollback"))
    return evidenceSource(data, "startup_rollback_plan");
  if (blocker.includes("observability")) {
    return evidenceSource(data, "startup_observability");
  }
  if (blocker.includes("founder bottleneck")) {
    return evidenceSource(data, "startup_founder_bottleneck");
  }

  return "report:launch_readiness_analysis";
}

function evidenceSource(data: LaunchReadinessReportData, type: string): string {
  const evidence =
    type === "command_output"
      ? (currentCommandEvidence(data)[0] ?? staleCommandEvidence(data)[0])
      : (currentEvidenceRows(data).find((item) => item.type === type) ??
        data.evidence.find((item) => item.type === type));

  return evidence === undefined ? "missing evidence" : `${evidence.id} ${evidence.uri}`;
}

function recommendedTaskForRisk(risk: string): string {
  if (risk.includes("test command")) return "add or configure a test script";
  if (risk.includes("lint command")) return "add or configure a lint script";
  if (risk.includes("typecheck command")) return "add or configure a typecheck script";
  if (risk.includes("build command")) return "add or configure a build script";
  if (risk.includes("CI configuration")) return "add CI for launch verifier commands";
  if (risk.includes("MVP verifier") || risk.includes("verifier command")) {
    return "run and record MVP verifier evidence";
  }
  if (risk.includes("measurement")) {
    return "run startup measurement generate and attach metric evidence";
  }
  if (risk.includes("repo readiness")) return "run startup launch audit";
  if (risk.includes("security baseline")) {
    return "run startup launch security-baseline";
  }
  if (risk.includes("migration")) return "record startup_migration_plan evidence";
  if (risk.includes("rollback")) return "record startup_rollback_plan evidence";
  if (risk.includes("observability")) return "record startup_observability evidence";
  if (risk.includes("founder bottleneck")) {
    return "run startup launch bottleneck-map";
  }
  if (risk.includes("protected path"))
    return "create review evidence for protected paths";
  if (risk.includes("approval")) return "resolve pending approval before launch";

  return "create a remediation task and attach evidence";
}

function formatTaskCounts(tasks: TaskReportRow[]): string {
  if (tasks.length === 0) {
    return "none";
  }

  const counts = new Map<string, number>();

  for (const task of tasks) {
    counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
  }

  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${status}:${count}`)
    .join(", ");
}

function hasCompletedTask(tasks: TaskReportRow[], type: string): boolean {
  return tasks.some((task) => task.type === type && task.status === "completed");
}

function hasEvidenceType(evidence: EvidenceReportRow[], type: string): boolean {
  return evidence.some((item) => item.type === type);
}

function listOrNone<T>(items: T[], formatter: (item: T) => string): string {
  if (items.length === 0) {
    return "- none";
  }

  return items.map(formatter).join("\n");
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
