import {
  defineRuntimeCompleteProductCriterion,
  runtimeCompleteProductArtifactCriterion
} from "@runstead/runtime";

import type { BuildDashboardResult } from "./dashboard.js";
import type { RepoInspectionSnapshot } from "./inspection-evidence.js";
import type {
  LaunchReadinessReportResult,
  LaunchReadinessTarget
} from "./launch-readiness-report.js";
import type { OpsDiagnosticsBundleResult } from "./ops-diagnostics.js";
import type { GenerateStartupCiSummaryResult } from "./startup-ci-integration.js";
import type {
  StartupCompleteProductBlockerAudit,
  StartupCompleteProductCriterion,
  StartupCompleteProductSurfaces
} from "./startup-complete-check-types.js";
import type { StartupCompleteProductEvidenceRow } from "./startup-complete-check-blockers.js";
export {
  startupCompleteProductBlockers,
  type StartupCompleteProductEvidenceRow
} from "./startup-complete-check-blockers.js";
import type { GenerateStartupRemediationPlanResult } from "./startup-remediation.js";
import type { StartupStatusResult } from "./startup-status.js";

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

export function startupCompleteProductBaseCriteria(input: {
  repo: RepoInspectionSnapshot;
  status: StartupStatusResult;
  launchReport: LaunchReadinessReportResult;
  remediation: GenerateStartupRemediationPlanResult;
  ci: GenerateStartupCiSummaryResult;
  dashboard: BuildDashboardResult;
  diagnostics: OpsDiagnosticsBundleResult;
  evidenceRows: StartupCompleteProductEvidenceRow[];
  blockers: StartupCompleteProductBlockerAudit[];
  eventCount: number;
  pathState: Map<string, boolean>;
  target: LaunchReadinessTarget;
}): StartupCompleteProductCriterion[] {
  const evidenceTypes = new Set(input.evidenceRows.map((item) => item.type));
  const sourceKinds = new Set(input.status.evidence.sourceKinds);
  const missingStartupEvidence = REQUIRED_STARTUP_EVIDENCE.filter(
    (type) => !evidenceTypes.has(type)
  );
  const repoRiskEvidence = input.evidenceRows.filter((item) =>
    [
      "startup_repo_readiness",
      "startup_security_baseline",
      "startup_release_plan"
    ].includes(item.type)
  );
  const deploymentVerified = sourceKinds.has("deployment");
  const repoDiscoveryMissing = [
    ...(input.repo.packageManager.detected ? [] : ["package manager"]),
    ...(input.repo.commands.test.detected ? [] : ["test command"]),
    ...(input.repo.commands.lint.detected ? [] : ["lint command"]),
    ...(input.repo.commands.typecheck.detected ? [] : ["typecheck command"]),
    ...(input.repo.commands.build.detected ? [] : ["build command"]),
    ...(input.target === "local" || input.repo.ci.detected ? [] : ["CI config"]),
    ...(evidenceTypes.has("startup_repo_readiness") ? [] : ["repo readiness evidence"]),
    ...(evidenceTypes.has("startup_security_baseline")
      ? []
      : ["security baseline evidence"]),
    ...(evidenceTypes.has("startup_release_plan") ? [] : ["release-plan evidence"]),
    ...(deploymentVerified ? [] : ["deployment verification evidence"])
  ];
  const reviewSurfaceMissing = missingPaths(input.pathState, [
    input.launchReport.reportPath,
    input.launchReport.jsonPath,
    input.ci.markdownPath,
    input.ci.jsonPath,
    input.dashboard.htmlPath,
    input.dashboard.dataPath,
    input.diagnostics.markdownPath,
    input.diagnostics.jsonPath
  ]);
  const diagnosticsMissing = [
    ...(input.diagnostics.stateBackupPath === undefined
      ? ["state backup"]
      : missingPaths(input.pathState, [input.diagnostics.stateBackupPath])),
    ...(input.eventCount > 0 ? [] : ["audit events"])
  ];

  return [
    criterion({
      id: "founder_golden_path",
      title: "Founder Golden Path",
      status:
        missingStartupEvidence.filter((type) =>
          ["startup_agent_context", "startup_measurement_framework"].includes(type)
        ).length === 0 && input.status.nextAction.command.trim().length > 0,
      severity: "critical",
      evidence: [
        input.status.nextAction.command,
        ...input.evidenceRows
          .filter((item) =>
            ["startup_agent_context", "startup_measurement_framework"].includes(
              item.type
            )
          )
          .map((item) => item.id)
      ],
      missing: missingStartupEvidence.filter((type) =>
        ["startup_agent_context", "startup_measurement_framework"].includes(type)
      ),
      nextAction: input.status.nextAction.command
    }),
    criterion({
      id: "repo_discovery_and_risk",
      title: "Repo Discovery And Risk",
      status: repoDiscoveryMissing.length === 0,
      severity: "critical",
      evidence: [
        `packageManager=${input.repo.packageManager.detected ? input.repo.packageManager.packageManager : "missing"}`,
        `ci=${input.repo.ci.detected ? input.repo.ci.providers.map((provider) => provider.provider).join(",") : "missing"}`,
        `deployment=${deploymentVerified ? "verified" : "missing"}`,
        ...repoRiskEvidence.map((item) => item.id)
      ],
      missing: repoDiscoveryMissing,
      nextAction:
        "record startup release-plan and deployment source evidence before public traffic"
    }),
    criterion({
      id: "launch_readiness_report",
      title: "Launch Readiness Report",
      status:
        ["launch_ready", "blocked"].includes(input.launchReport.status) &&
        input.pathState.get(input.launchReport.reportPath) === true &&
        input.pathState.get(input.launchReport.jsonPath) === true,
      severity: "critical",
      evidence: [
        input.launchReport.reportPath,
        input.launchReport.jsonPath,
        `status=${input.launchReport.status}`,
        `trust=${Math.round(input.launchReport.trustSummary.qualityScore * 100)}%`
      ],
      missing: missingPaths(input.pathState, [
        input.launchReport.reportPath,
        input.launchReport.jsonPath
      ]),
      nextAction: "runstead startup launch report --print"
    }),
    criterion({
      id: "blocker_accountability",
      title: "Blocker Accountability",
      status: input.blockers.every(
        (blocker) =>
          blocker.owner.length > 0 &&
          blocker.remediationTask.length > 0 &&
          blocker.evidenceSources.length > 0
      ),
      severity: "critical",
      evidence: input.blockers.flatMap((blocker) => blocker.evidenceSources),
      missing: input.blockers
        .filter(
          (blocker) =>
            blocker.owner.length === 0 ||
            blocker.remediationTask.length === 0 ||
            blocker.evidenceSources.length === 0
        )
        .map((blocker) => blocker.blocker),
      nextAction: "runstead startup gate check --stage launch"
    }),
    criterion({
      id: "remediation_loop",
      title: "Remediation Loop",
      status:
        input.remediation.status === "clear" ||
        input.remediation.tasks.every((item) => item.acceptanceCriteria.length > 0),
      severity: "critical",
      evidence: [
        `status=${input.remediation.status}`,
        ...input.remediation.tasks.map((item) => item.task.id)
      ],
      missing:
        input.remediation.status === "clear"
          ? []
          : input.remediation.tasks
              .filter((item) => item.acceptanceCriteria.length === 0)
              .map((item) => item.blocker),
      nextAction:
        "runstead startup remediate --stage launch --execute --worker codex_cli"
    }),
    criterion({
      id: "review_surfaces",
      title: "Dashboard Markdown JSON Review",
      status: reviewSurfaceMissing.length === 0,
      severity: "major",
      evidence: [
        input.dashboard.htmlPath,
        input.dashboard.dataPath,
        input.launchReport.reportPath,
        input.launchReport.jsonPath
      ],
      missing: reviewSurfaceMissing,
      nextAction: "runstead dashboard build && runstead startup launch report"
    }),
    criterion({
      id: "ci_pr_gate",
      title: "CI PR Gate",
      status:
        ["success", "failure"].includes(input.ci.checkRun.conclusion) &&
        input.ci.releaseDecision.status === "allow_release" &&
        input.pathState.get(input.ci.jsonPath) === true,
      severity: "critical",
      evidence: [
        input.ci.jsonPath,
        input.ci.markdownPath,
        `check=${input.ci.checkRun.conclusion}`,
        `release=${input.ci.releaseDecision.status}`,
        `readiness=${input.ci.releaseDecision.readinessVerdict ?? "not_evaluated"}`,
        `gateEvent=${input.ci.gate.event.eventId}`
      ],
      missing: [
        ...missingPaths(input.pathState, [input.ci.jsonPath, input.ci.markdownPath]),
        ...(input.ci.releaseDecision.status === "allow_release"
          ? []
          : input.ci.releaseDecision.blockers)
      ],
      nextAction: "runstead startup ci summary --stage launch"
    }),
    criterion({
      id: "operations_resume_audit",
      title: "Operations Resume Audit",
      status: diagnosticsMissing.length === 0,
      severity: "major",
      evidence: [
        input.diagnostics.markdownPath,
        input.diagnostics.jsonPath,
        ...(input.diagnostics.stateBackupPath === undefined
          ? []
          : [input.diagnostics.stateBackupPath]),
        `events=${input.eventCount}`
      ],
      missing: diagnosticsMissing,
      nextAction: "runstead ops diagnostics && runstead resume"
    })
  ];
}

export function startupCompleteProductArtifactCriterion(
  surfaces: StartupCompleteProductSurfaces
): StartupCompleteProductCriterion {
  return runtimeCompleteProductArtifactCriterion(surfaces);
}

function criterion(input: {
  id: string;
  title: string;
  status: boolean;
  severity: StartupCompleteProductCriterion["severity"];
  evidence: string[];
  missing: string[];
  nextAction: string;
}): StartupCompleteProductCriterion {
  return defineRuntimeCompleteProductCriterion({
    id: input.id,
    title: input.title,
    passed: input.status,
    severity: input.severity,
    evidence: input.evidence,
    missing: input.missing,
    nextAction: input.nextAction
  });
}

function missingPaths(pathState: Map<string, boolean>, paths: string[]): string[] {
  return paths.filter((path) => pathState.get(path) !== true);
}
