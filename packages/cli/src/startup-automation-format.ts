import type { collectRepoInspection } from "./inspection-evidence.js";
import {
  formatDetectedCommand,
  listItems,
  listItemsOrNone
} from "./startup-format-helpers.js";

export {
  contextForFile,
  formatStartupAgentContext,
  startupContextEvidenceSummary
} from "./startup-context-format.js";
export {
  formatDetectedCommand,
  listItems,
  listItemsOrNone,
  safeTimestamp
} from "./startup-format-helpers.js";
export { formatSecurityBaseline } from "./startup-security-baseline-format.js";
export {
  formatDelegationPolicy,
  formatFounderBottleneckMap,
  formatGtmVerification,
  formatInstitutionalMemory,
  formatIntegrationMap,
  formatOpsSops,
  formatScaleOpsReport,
  formatScaleReportSchedule,
  formatScaleStarterPack,
  formatWorkflowRegistry
} from "./startup-scale-format.js";

export function formatMeasurementFramework(input: {
  generatedAt: string;
  activationMetric?: string;
  retentionMetric?: string;
  day7Metric?: string;
  day30Metric?: string;
  falsePositiveMetric?: string;
}): string {
  const activation =
    input.activationMetric ?? "User completes the first successful core workflow.";
  const retention =
    input.retentionMetric ?? "User returns and completes a core workflow again.";
  const day7 = input.day7Metric ?? "Day 7 retained active users by signup cohort.";
  const day30 = input.day30Metric ?? "Day 30 retained active users by signup cohort.";
  const falsePositive =
    input.falsePositiveMetric ??
    "Runstead or product claim is counted as success without user-confirmed value.";

  return [
    "# Startup Measurement Framework",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Launch Rule",
    "",
    "Runstead must not mark the MVP launch-ready without this measurement framework and current verifier evidence.",
    "",
    "## Metrics",
    "",
    `- Activation: ${activation}`,
    `- Retention: ${retention}`,
    `- Day 7: ${day7}`,
    `- Day 30: ${day30}`,
    `- False-positive metric: ${falsePositive}`,
    "",
    "## Evidence Requirements",
    "",
    "- Attach customer, product, or analytics evidence before treating a metric as validated.",
    "- Link metric evidence to the startup goal or decision it supports.",
    "- Re-run the launch gate after metrics or verifier evidence changes.",
    ""
  ].join("\n");
}

export function measurementMetricDefinitions(input: {
  activationMetric?: string;
  retentionMetric?: string;
  day7Metric?: string;
  day30Metric?: string;
  falsePositiveMetric?: string;
}): Record<string, unknown>[] {
  return [
    {
      key: "activation",
      definition:
        input.activationMetric ?? "User completes the first successful core workflow.",
      requiredSnapshotFields: ["source", "threshold", "current", "snapshotDate"]
    },
    {
      key: "retention",
      definition:
        input.retentionMetric ?? "User returns and completes a core workflow again.",
      requiredSnapshotFields: ["source", "threshold", "current", "snapshotDate"]
    },
    {
      key: "d7_retention",
      definition: input.day7Metric ?? "Day 7 retained active users by signup cohort.",
      requiredSnapshotFields: ["source", "threshold", "current", "snapshotDate"]
    },
    {
      key: "d30_retention",
      definition: input.day30Metric ?? "Day 30 retained active users by signup cohort.",
      requiredSnapshotFields: ["source", "threshold", "current", "snapshotDate"]
    },
    {
      key: "false_positive",
      definition:
        input.falsePositiveMetric ??
        "Runstead or product claim is counted as success without user-confirmed value.",
      requiredSnapshotFields: ["source", "falsePositive", "snapshotDate"]
    }
  ];
}

export function formatRepoReadinessAudit(input: {
  generatedAt: string;
  inspection: Awaited<ReturnType<typeof collectRepoInspection>>;
  changedProtected: string[];
  blockers: string[];
  warnings: string[];
}): string {
  const packageManager = input.inspection.packageManager.detected
    ? `${input.inspection.packageManager.packageManager} (${input.inspection.packageManager.source})`
    : "missing";
  const ci = input.inspection.ci.detected
    ? input.inspection.ci.providers.map((provider) => provider.provider).join(", ")
    : "missing";

  return [
    "# Startup Repository Readiness Audit",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Repository Signals",
    "",
    `- Git repo: ${input.inspection.git.isGitRepo ? "yes" : "no"}`,
    `- Branch: ${input.inspection.git.branch ?? "unknown"}`,
    `- Package manager: ${packageManager}`,
    `- Test command: ${formatDetectedCommand(input.inspection.commands.test)}`,
    `- Lint command: ${formatDetectedCommand(input.inspection.commands.lint)}`,
    `- Typecheck command: ${formatDetectedCommand(input.inspection.commands.typecheck)}`,
    `- Build command: ${formatDetectedCommand(input.inspection.commands.build)}`,
    `- CI: ${ci}`,
    "",
    "## Protected Path Changes",
    "",
    listItemsOrNone(input.changedProtected),
    "",
    "## Release Blockers",
    "",
    listItemsOrNone(input.blockers),
    "",
    "## Warnings",
    "",
    listItemsOrNone(input.warnings),
    "",
    "## Evidence Required Before Launch",
    "",
    listItems([
      "startup_repo_readiness from this audit",
      "startup_security_baseline from security baseline generation",
      "command_output from test, lint, typecheck, and build verifier runs",
      "startup_migration_plan if persistence or schema changes exist",
      "startup_rollback_plan for the release path",
      "startup_observability for launch monitoring"
    ]),
    ""
  ].join("\n");
}

export function formatSupportTriage(input: {
  generatedAt: string;
  request: string;
  outcome: string;
  customer?: string;
  severity: string;
  category: string;
  sourceRefs: string[];
}): string {
  return [
    "# Startup Support Triage",
    "",
    `Generated: ${input.generatedAt}`,
    `Customer: ${input.customer ?? "unknown"}`,
    `Severity: ${input.severity}`,
    `Category: ${input.category}`,
    "",
    "## Request",
    "",
    input.request,
    "",
    "## Outcome",
    "",
    input.outcome,
    "",
    "## Source Evidence",
    "",
    listItemsOrNone(input.sourceRefs),
    "",
    "## Follow-up Contract",
    "",
    listItems([
      "Attach this triage evidence to the relevant goal, decision, or remediation task.",
      "Convert repeated support categories into product or documentation work.",
      "Re-run launch readiness after support evidence changes release risk."
    ]),
    ""
  ].join("\n");
}
