import type { LaunchReadinessReportData } from "./launch-readiness-data.js";
import {
  frontendUiValidation,
  changeAuthorship,
  evidenceProvenance,
  metricEvidenceConfidence,
  staleEvidenceAppendix,
  staleEvidenceSummary,
  verifierStatus
} from "./launch-readiness-report-evidence-format.js";
import type { LaunchReadinessStatus } from "./launch-readiness-trust.js";
import { listOrNone } from "./launch-readiness-report-helpers.js";
import { blockerSource, riskRegister } from "./launch-readiness-risk-format.js";
import {
  acceptableDebt,
  architecturalDebt,
  dependencyAndSecurityRisk,
  governanceBoundary,
  missingObservability,
  nextSprintPlan,
  nextTargetBlockers,
  repoHealth,
  structuredStartupArtifacts,
  testCoverageGaps,
  trustSummaryMarkdown
} from "./launch-readiness-report-sections.js";
import type {
  LaunchReadinessTarget,
  LaunchReadinessTargetStatus
} from "./launch-readiness-types.js";
import type { LaunchReadinessTrustSummary } from "./launch-readiness-trust.js";

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
