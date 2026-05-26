import {
  formatCategoryCounts,
  formatEvidenceSummary,
  type StartupEvidenceSummaryRow
} from "./startup-evidence-summary.js";

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

function listItems(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function listItemsOrNone(items: string[]): string {
  return items.length === 0 ? "- none" : listItems(items);
}
