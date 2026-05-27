import type { BuildDashboardResult } from "./dashboard.js";
import type { LaunchReadinessReportResult } from "./launch-readiness-report.js";
import type { OpsDiagnosticsBundleResult } from "./ops-diagnostics.js";
import type { GenerateStartupCiSummaryResult } from "./startup-ci-integration.js";
import type { StartupCompleteProductSurfaces } from "./startup-complete-check-types.js";

interface StartupCompleteProductReviewSurfaceInputs {
  launchReport: LaunchReadinessReportResult;
  ci: GenerateStartupCiSummaryResult;
  dashboard: BuildDashboardResult;
  diagnostics: OpsDiagnosticsBundleResult;
}

export function startupCompleteProductExistingArtifactPaths(
  input: StartupCompleteProductReviewSurfaceInputs
): string[] {
  return [
    input.launchReport.reportPath,
    input.launchReport.jsonPath,
    input.ci.markdownPath,
    input.ci.jsonPath,
    input.dashboard.htmlPath,
    input.dashboard.dataPath,
    input.diagnostics.markdownPath,
    input.diagnostics.jsonPath,
    ...(input.diagnostics.stateBackupPath === undefined
      ? []
      : [input.diagnostics.stateBackupPath])
  ];
}

export function startupCompleteProductEvidenceSourceRefs(
  input: StartupCompleteProductReviewSurfaceInputs & {
    markdownPath: string;
    jsonPath: string;
  }
): string[] {
  return [
    input.markdownPath,
    input.jsonPath,
    input.launchReport.reportPath,
    input.launchReport.jsonPath,
    input.ci.markdownPath,
    input.ci.jsonPath,
    input.dashboard.htmlPath,
    input.dashboard.dataPath,
    input.diagnostics.markdownPath,
    input.diagnostics.jsonPath
  ];
}

export function startupCompleteProductSurfaces(
  input: StartupCompleteProductReviewSurfaceInputs & {
    markdownPath: string;
    jsonPath: string;
    evidenceId: string;
    eventId: string;
  }
): StartupCompleteProductSurfaces {
  return {
    launchReportMarkdown: input.launchReport.reportPath,
    launchReportJson: input.launchReport.jsonPath,
    ciMarkdown: input.ci.markdownPath,
    ciJson: input.ci.jsonPath,
    dashboardHtml: input.dashboard.htmlPath,
    dashboardJson: input.dashboard.dataPath,
    diagnosticsMarkdown: input.diagnostics.markdownPath,
    diagnosticsJson: input.diagnostics.jsonPath,
    completeCheckMarkdown: input.markdownPath,
    completeCheckJson: input.jsonPath,
    evidenceId: input.evidenceId,
    eventId: input.eventId
  };
}
