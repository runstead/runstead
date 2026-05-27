import type { LaunchReadinessReportResult } from "./launch-readiness-report.js";
import type { OpsDiagnosticsBundleResult } from "./ops-diagnostics.js";
import type { GenerateStartupCiSummaryResult } from "./startup-ci-integration.js";
import { startupCompleteProductArtifactCriterion } from "./startup-complete-check-criteria.js";
import {
  completeProductScore,
  completeProductStatus,
  startupCompleteProductEvent
} from "./startup-complete-check-output.js";
import type {
  StartupCompleteProductBlockerAudit,
  StartupCompleteProductCheckResult,
  StartupCompleteProductCriterion,
  StartupCompleteProductSurfaces
} from "./startup-complete-check-types.js";
import type { GenerateStartupRemediationPlanResult } from "./startup-remediation.js";

export function buildStartupCompleteProductCheckResult(input: {
  root: string;
  stateDb: string;
  domain: string;
  generatedAt: string;
  markdownPath: string;
  jsonPath: string;
  eventId: string;
  evidenceId: string;
  baseCriteria: StartupCompleteProductCriterion[];
  blockers: StartupCompleteProductBlockerAudit[];
  surfaces: StartupCompleteProductSurfaces;
  launchReport: LaunchReadinessReportResult;
  ci: GenerateStartupCiSummaryResult;
  remediation: GenerateStartupRemediationPlanResult;
  diagnostics: OpsDiagnosticsBundleResult;
}): StartupCompleteProductCheckResult {
  const criteria = [
    ...input.baseCriteria,
    startupCompleteProductArtifactCriterion(input.surfaces)
  ];
  const status = completeProductStatus(criteria);
  const score = completeProductScore(criteria);
  const event = startupCompleteProductEvent({
    eventId: input.eventId,
    domain: input.domain,
    generatedAt: input.generatedAt,
    status,
    score,
    markdownPath: input.markdownPath,
    jsonPath: input.jsonPath,
    evidenceId: input.evidenceId,
    criteria,
    blockers: input.blockers,
    launchReport: input.launchReport,
    ci: input.ci,
    remediation: input.remediation,
    diagnostics: input.diagnostics
  });

  return {
    root: input.root,
    stateDb: input.stateDb,
    domain: input.domain,
    generatedAt: input.generatedAt,
    status,
    score,
    markdownPath: input.markdownPath,
    jsonPath: input.jsonPath,
    markdown: "",
    event,
    evidenceId: input.evidenceId,
    criteria,
    blockers: input.blockers,
    surfaces: input.surfaces
  };
}
