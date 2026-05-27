import type { BuildDashboardResult } from "./dashboard.js";
import type { RepoInspectionSnapshot } from "./inspection-evidence.js";
import type {
  LaunchReadinessReportResult,
  LaunchReadinessTarget
} from "./launch-readiness-report.js";
import type { OpsDiagnosticsBundleResult } from "./ops-diagnostics.js";
import type { GenerateStartupCiSummaryResult } from "./startup-ci-integration.js";
import type { StartupCompleteProductEvidenceRow } from "./startup-complete-check-blockers.js";

const REQUIRED_STARTUP_EVIDENCE = [
  "startup_agent_context",
  "startup_measurement_framework",
  "startup_metric_snapshot",
  "startup_repo_readiness",
  "startup_security_baseline",
  "startup_migration_plan",
  "startup_rollback_plan",
  "startup_observability",
  "startup_founder_bottleneck"
];

const REPO_RISK_EVIDENCE_TYPES = [
  "startup_repo_readiness",
  "startup_security_baseline",
  "startup_release_plan"
];

export function startupCompleteProductMissingStartupEvidence(
  evidenceTypes: Set<string>
): string[] {
  return REQUIRED_STARTUP_EVIDENCE.filter((type) => !evidenceTypes.has(type));
}

export function startupCompleteProductRepoRiskEvidence(
  evidenceRows: StartupCompleteProductEvidenceRow[]
): StartupCompleteProductEvidenceRow[] {
  return evidenceRows.filter((item) => REPO_RISK_EVIDENCE_TYPES.includes(item.type));
}

export function startupCompleteProductRepoDiscoveryMissing(input: {
  repo: RepoInspectionSnapshot;
  target: LaunchReadinessTarget;
  evidenceTypes: Set<string>;
  deploymentVerified: boolean;
}): string[] {
  return [
    ...(input.repo.packageManager.detected ? [] : ["package manager"]),
    ...(input.repo.commands.test.detected ? [] : ["test command"]),
    ...(input.repo.commands.lint.detected ? [] : ["lint command"]),
    ...(input.repo.commands.typecheck.detected ? [] : ["typecheck command"]),
    ...(input.repo.commands.build.detected ? [] : ["build command"]),
    ...(input.target === "local" || input.repo.ci.detected ? [] : ["CI config"]),
    ...(input.evidenceTypes.has("startup_repo_readiness")
      ? []
      : ["repo readiness evidence"]),
    ...(input.evidenceTypes.has("startup_security_baseline")
      ? []
      : ["security baseline evidence"]),
    ...(input.evidenceTypes.has("startup_release_plan")
      ? []
      : ["release-plan evidence"]),
    ...(input.deploymentVerified ? [] : ["deployment verification evidence"])
  ];
}

export function startupCompleteProductReviewSurfaceMissing(input: {
  pathState: Map<string, boolean>;
  launchReport: LaunchReadinessReportResult;
  ci: GenerateStartupCiSummaryResult;
  dashboard: BuildDashboardResult;
  diagnostics: OpsDiagnosticsBundleResult;
}): string[] {
  return startupCompleteProductMissingPaths(input.pathState, [
    input.launchReport.reportPath,
    input.launchReport.jsonPath,
    input.ci.markdownPath,
    input.ci.jsonPath,
    input.dashboard.htmlPath,
    input.dashboard.dataPath,
    input.diagnostics.markdownPath,
    input.diagnostics.jsonPath
  ]);
}

export function startupCompleteProductDiagnosticsMissing(input: {
  pathState: Map<string, boolean>;
  diagnostics: OpsDiagnosticsBundleResult;
  eventCount: number;
}): string[] {
  return [
    ...(input.diagnostics.stateBackupPath === undefined
      ? ["state backup"]
      : startupCompleteProductMissingPaths(input.pathState, [
          input.diagnostics.stateBackupPath
        ])),
    ...(input.eventCount > 0 ? [] : ["audit events"])
  ];
}

export function startupCompleteProductMissingPaths(
  pathState: Map<string, boolean>,
  paths: string[]
): string[] {
  return paths.filter((path) => pathState.get(path) !== true);
}
