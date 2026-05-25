import type { collectRepoInspection } from "./inspection-evidence.js";
import type { LaunchSecurityRiskScan } from "./startup-automation-types.js";
import {
  formatCategoryCounts,
  formatEvidenceSummary,
  type StartupEvidenceSummaryRow
} from "./startup-evidence-summary.js";

export function startupContextEvidenceSummary(input: {
  generatedCount: number;
  ingestedCount: number;
}): string {
  if (input.ingestedCount === 0) {
    return "Generated startup agent context files";
  }

  if (input.generatedCount === 0) {
    return "Ingested existing startup agent context files";
  }

  return "Generated and ingested startup agent context files";
}

export function formatStartupAgentContext(input: {
  generatedAt: string;
  architecturePrinciples?: string[];
  technicalConstraints?: string[];
  acceptedDebt?: string[];
  inspection: Awaited<ReturnType<typeof collectRepoInspection>>;
}): string {
  const testCommand = input.inspection.commands.test.detected
    ? input.inspection.commands.test.command
    : "missing";
  const lintCommand = input.inspection.commands.lint.detected
    ? input.inspection.commands.lint.command
    : "missing";
  const typecheckCommand = input.inspection.commands.typecheck.detected
    ? input.inspection.commands.typecheck.command
    : "missing";
  const buildCommand = input.inspection.commands.build.detected
    ? input.inspection.commands.build.command
    : "missing";
  const ci = input.inspection.ci.detected
    ? input.inspection.ci.providers.map((provider) => provider.provider).join(", ")
    : "missing";
  const packageManager = input.inspection.packageManager.detected
    ? `${input.inspection.packageManager.packageManager} (${input.inspection.packageManager.source})`
    : "missing";

  return [
    "# Startup Agent Context",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Execution Contract",
    "",
    "- Runstead is the control plane for goals, policy, evidence, verifiers, audit, and resume.",
    "- Worker agents execute inside the scope and verifier expectations recorded here.",
    "- Do not claim launch readiness without verifier evidence and measurement framework evidence.",
    "",
    "## Repository Facts",
    "",
    `- Git repo: ${input.inspection.git.isGitRepo ? "yes" : "no"}`,
    `- Branch: ${input.inspection.git.branch ?? "unknown"}`,
    `- Package manager: ${packageManager}`,
    `- Test command: ${testCommand}`,
    `- Lint command: ${lintCommand}`,
    `- Typecheck command: ${typecheckCommand}`,
    `- Build command: ${buildCommand}`,
    `- CI: ${ci}`,
    "",
    "## Architecture Principles",
    "",
    listItems(
      input.architecturePrinciples ?? [
        "Prefer repo-local patterns and existing framework conventions.",
        "Keep startup execution artifacts evidence-backed and auditable.",
        "Preserve repo-maintenance as the first product path while extending startup readiness."
      ]
    ),
    "",
    "## Technical Constraints",
    "",
    listItems(
      input.technicalConstraints ?? [
        "Protected paths and secrets must not be edited without explicit approval.",
        "External writes, publishing, and dependency changes require approval.",
        "Verifier commands must be recorded as evidence before release decisions."
      ]
    ),
    "",
    "## Accepted Technical Debt",
    "",
    listItems(
      input.acceptedDebt ?? ["No accepted startup technical debt recorded yet."]
    ),
    "",
    "## Verifier Commands",
    "",
    listItems([
      `test: ${testCommand}`,
      `lint: ${lintCommand}`,
      `typecheck: ${typecheckCommand}`,
      `build: ${buildCommand}`
    ]),
    "",
    "## Startup Stage Gates",
    "",
    "- MVP: agent context, measurement framework, repo readiness, and verifier evidence.",
    "- Launch: release blockers resolved, observability present, and launch readiness report generated.",
    "- Scale: founder bottlenecks, workflow registry, SOPs, support triage, and GTM evidence verified.",
    ""
  ].join("\n");
}

export function contextForFile(filename: string, baseContext: string): string {
  return [`# ${filename}`, "", baseContext].join("\n");
}

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

export function listItems(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
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

export function formatSecurityBaseline(input: {
  generatedAt: string;
  changedProtected: string[];
  envFiles: string[];
  dependencyFiles: string[];
  riskScan: LaunchSecurityRiskScan;
  blockers: string[];
  warnings: string[];
}): string {
  return [
    "# Startup Security Baseline",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Protected Path Changes",
    "",
    listItemsOrNone(input.changedProtected),
    "",
    "## Local Secret And Env Files",
    "",
    listItemsOrNone(input.envFiles),
    "",
    "## Dependency Manifests",
    "",
    listItemsOrNone(input.dependencyFiles),
    "",
    "## Launch Risk Scan",
    "",
    "### Secret Findings",
    listItemsOrNone(input.riskScan.secretFindings),
    "",
    "### License Findings",
    listItemsOrNone(input.riskScan.licenseFindings),
    "",
    "### Dependency Findings",
    listItemsOrNone(input.riskScan.dependencyFindings),
    "",
    "### Backup And Restore Findings",
    listItemsOrNone(input.riskScan.backupRestoreFindings),
    "",
    "### Auth And Privacy Findings",
    listItemsOrNone(input.riskScan.authAndPrivacyFindings),
    "",
    "### Production Config Findings",
    listItemsOrNone(input.riskScan.prodConfigFindings),
    "",
    "### Third-party Integration Findings",
    listItemsOrNone(input.riskScan.thirdPartyFindings),
    "",
    "## Launch Security Blockers",
    "",
    listItemsOrNone(input.blockers),
    "",
    "## Warnings",
    "",
    listItemsOrNone(input.warnings),
    "",
    "## Release Evidence Contract",
    "",
    listItems([
      "No changed protected path may launch without explicit review evidence.",
      "Secrets must stay out of committed evidence and reports.",
      "Dependency changes require verifier evidence and rollback notes.",
      "Run startup gate check --stage launch after recording migration, rollback, and observability evidence."
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

export function formatFounderBottleneckMap(input: {
  generatedAt: string;
  bottlenecks: string[];
  owner: string;
  systemOfRecord: string;
  status: string;
  handoffDueDate?: string;
}): string {
  return [
    "# Founder Bottleneck Map",
    "",
    `Generated: ${input.generatedAt}`,
    `Owner: ${input.owner}`,
    `System of record: ${input.systemOfRecord}`,
    `Status: ${input.status}`,
    ...(input.handoffDueDate === undefined
      ? []
      : [`Handoff due: ${input.handoffDueDate}`]),
    "",
    "## Founder-only Bottlenecks",
    "",
    listItems(input.bottlenecks),
    "",
    "## Handoff Requirements",
    "",
    listItems([
      "Each bottleneck needs an owner or durable system of record.",
      "Credential, customer, release, and architecture knowledge must be moved into governed artifacts.",
      "Repeat this audit before scale-stage workflow delegation."
    ]),
    ""
  ].join("\n");
}

export function formatWorkflowRegistry(input: {
  generatedAt: string;
  workflows: string[];
  approvalBoundaries: string[];
}): string {
  return [
    "# Startup Workflow Registry",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Recurring Workflows",
    "",
    listItems(input.workflows),
    "",
    "## Automation Coverage Contract",
    "",
    listItems([
      "Each recurring workflow needs a trigger, owner, evidence output, and verifier.",
      "Agent-run workflows must write evidence before claiming completion.",
      "Workflow changes crossing an approval boundary must create an approval request."
    ]),
    "",
    "## Approval Boundaries",
    "",
    listItems(input.approvalBoundaries),
    ""
  ].join("\n");
}

export function formatDelegationPolicy(input: {
  generatedAt: string;
  delegationRules: string[];
  approvalBoundaries: string[];
  allowedAgents: string[];
  constrainedTaskTypes: string[];
}): string {
  return [
    "# Startup Delegation Policy",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Delegation Rules",
    "",
    listItems(input.delegationRules),
    "",
    "## Approval Boundaries",
    "",
    listItems(input.approvalBoundaries),
    "",
    "## Allowed Agents",
    "",
    listItems(input.allowedAgents),
    "",
    "## Constrained Task Types",
    "",
    listItems(input.constrainedTaskTypes),
    "",
    "## Audit Contract",
    "",
    listItems([
      "Agents are workers; Runstead remains the control plane.",
      "Delegated work must be linked to goals, tasks, evidence, or approvals.",
      "Founder-only decisions must move into decision records or memory artifacts before scale."
    ]),
    ""
  ].join("\n");
}

export function formatInstitutionalMemory(input: {
  generatedAt: string;
  scope: string;
  knowledge: string[];
  sourceRefs: string[];
}): string {
  return [
    "# Startup Institutional Memory",
    "",
    `Generated: ${input.generatedAt}`,
    `Scope: ${input.scope}`,
    "",
    "## Captured Knowledge",
    "",
    listItems(input.knowledge),
    "",
    "## Source References",
    "",
    listItemsOrNone(input.sourceRefs),
    "",
    "## Verification Contract",
    "",
    listItems([
      "Founder-only context must become a verified project fact or decision record.",
      "Conflicting facts must be resolved before delegation.",
      "Memory retrieval must remain auditable through Runstead events."
    ]),
    ""
  ].join("\n");
}

export function formatIntegrationMap(input: {
  generatedAt: string;
  integrations: string[];
  lockInSignals: string[];
  automationCoverage: string[];
  adoptionSignals: string[];
  workflowSignals: string[];
}): string {
  return [
    "# Startup Integration Depth Map",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Integrations",
    "",
    listItems(input.integrations),
    "",
    "## Workflow Lock-in Signals",
    "",
    listItemsOrNone(input.lockInSignals),
    "",
    "## Automation Coverage",
    "",
    listItemsOrNone(input.automationCoverage),
    "",
    "## Adoption Signals",
    "",
    listItemsOrNone(input.adoptionSignals),
    "",
    "## Workflow Signals",
    "",
    listItemsOrNone(input.workflowSignals),
    "",
    "## Scale Contract",
    "",
    listItems([
      "Each critical integration needs an owner, failure mode, and support path.",
      "Workflow lock-in claims need customer evidence or usage metrics.",
      "Automation coverage must map to recurring workflow registry entries."
    ]),
    ""
  ].join("\n");
}

export function formatScaleOpsReport(input: {
  generatedAt: string;
  period: string;
  evidence: StartupEvidenceSummaryRow[];
  supportCategoryCounts: Record<string, number>;
  blockers: string[];
}): string {
  const supportEvidence = input.evidence.filter(
    (item) => item.type === "startup_support_triage"
  );
  const engineeringEvidence = input.evidence.filter((item) =>
    [
      "startup_repo_readiness",
      "startup_security_baseline",
      "startup_workflow_registry",
      "startup_delegation_policy",
      "startup_ops_sop"
    ].includes(item.type)
  );
  const gtmEvidence = input.evidence.filter((item) =>
    ["startup_customer_interview", "startup_metric", "startup_gtm_artifact"].includes(
      item.type
    )
  );

  return [
    "# Startup Scale Ops Report",
    "",
    `Generated: ${input.generatedAt}`,
    `Period: ${input.period}`,
    "",
    "## Scale Gate Blockers",
    "",
    listItems(input.blockers),
    "",
    "## Weekly Ops Evidence",
    "",
    formatEvidenceSummary(supportEvidence),
    "",
    "## Support Category Aggregation",
    "",
    formatCategoryCounts(input.supportCategoryCounts),
    "",
    "## Weekly Engineering Evidence",
    "",
    formatEvidenceSummary(engineeringEvidence),
    "",
    "## Weekly GTM Evidence",
    "",
    formatEvidenceSummary(gtmEvidence),
    "",
    "## Recent Startup Evidence",
    "",
    formatEvidenceSummary(input.evidence.slice(0, 10)),
    "",
    "## Recurring Report Contract",
    "",
    listItems([
      "Ops, engineering, and GTM sections must cite Runstead evidence.",
      "Missing evidence should become the next scale-stage task.",
      "This report should be regenerated before weekly planning."
    ]),
    ""
  ].join("\n");
}

export function formatScaleStarterPack(input: {
  generatedAt: string;
  owner: string;
  files: string[];
  evidenceIds: string[];
  blockers: string[];
  nextCommands: string[];
}): string {
  return [
    "# Startup Scale Starter Pack",
    "",
    `Generated: ${input.generatedAt}`,
    `Owner: ${input.owner}`,
    "Scale-ready: false",
    "",
    "## Starter Artifacts",
    "",
    listItems(input.files),
    "",
    "## Evidence",
    "",
    listItems(input.evidenceIds),
    "",
    "## Current Scale Gate Blockers",
    "",
    listItems(input.blockers),
    "",
    "## Starter Pack Boundary",
    "",
    listItems([
      "This pack creates operating templates and evidence surfaces only.",
      "It does not mark the product scale-ready.",
      "Run the scale gate after real workflow, support, SOP, metric, and GTM evidence is current."
    ]),
    "",
    "## Next Commands",
    "",
    listItems(input.nextCommands),
    ""
  ].join("\n");
}

export function formatScaleReportSchedule(input: {
  generatedAt: string;
  cadence: string;
  owner: string;
  nextRunAt: string;
  periodTemplate: string;
  nextCommand: string;
}): string {
  return [
    "# Startup Scale Report Schedule",
    "",
    `Generated: ${input.generatedAt}`,
    `Cadence: ${input.cadence}`,
    `Owner: ${input.owner}`,
    `Next run: ${input.nextRunAt}`,
    `Period template: ${input.periodTemplate}`,
    `Command: ${input.nextCommand}`,
    "",
    "## Recurrence Contract",
    "",
    listItems([
      "Generate the scale report on the recorded cadence.",
      "Attach generated reports as startup_ops_report evidence.",
      "Review overdue handoffs, support categories, delegation constraints, memory retrieval, integrations, and GTM claims."
    ]),
    ""
  ].join("\n");
}

export function formatOpsSops(input: {
  generatedAt: string;
  sops: string[];
  owner: string;
  workflow: string;
}): string {
  return [
    "# Startup Ops SOPs",
    "",
    `Generated: ${input.generatedAt}`,
    `Owner: ${input.owner}`,
    `Workflow: ${input.workflow}`,
    "",
    "## SOPs",
    "",
    listItems(input.sops),
    "",
    "## Handoff Checklist",
    "",
    listItems([
      "Each SOP must define trigger, inputs, steps, evidence output, owner, and escalation path.",
      "Agent-executed SOPs must write evidence before completion.",
      "Publishing or external writes still follow delegation policy approval boundaries."
    ]),
    ""
  ].join("\n");
}

export function formatGtmVerification(input: {
  generatedAt: string;
  claims: string[];
  evidenceRefs: string[];
  productState: string;
}): string {
  return [
    "# Startup GTM Artifact Verification",
    "",
    `Generated: ${input.generatedAt}`,
    `Product state: ${input.productState}`,
    "",
    "## Claims",
    "",
    listItems(input.claims),
    "",
    "## Evidence References",
    "",
    listItemsOrNone(input.evidenceRefs),
    "",
    "## Publish Contract",
    "",
    listItems([
      "Every external GTM claim needs customer, metric, or product-state evidence.",
      "Claims that exceed current product state must be blocked before publish.",
      "Publishing GTM artifacts requires approval under the startup delegation policy."
    ]),
    ""
  ].join("\n");
}

export function formatDetectedCommand(command: {
  detected: boolean;
  command?: string;
}): string {
  return command.detected ? (command.command ?? "detected") : "missing";
}

export function listItemsOrNone(items: string[]): string {
  return items.length === 0 ? "- none" : listItems(items);
}

export function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}
