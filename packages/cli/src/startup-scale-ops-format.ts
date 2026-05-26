import { listItems, listItemsOrNone } from "./startup-format-helpers.js";
import {
  formatCategoryCounts,
  formatEvidenceSummary,
  type StartupEvidenceSummaryRow
} from "./startup-evidence-summary.js";

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
