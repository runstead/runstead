import { resolve } from "node:path";

import { generateLaunchReadinessReport } from "./launch-readiness-report.js";
import {
  generateRepoReadinessAudit,
  generateScaleOpsReport,
  generateSecurityBaseline,
  initStartup
} from "./startup-automation.js";
import { checkStartupGate } from "./startup-evidence.js";
import type {
  StartupFounderFlowOptions,
  StartupLaunchCheckResult,
  StartupScaleCheckResult
} from "./startup-founder-types.js";

export { startupBuildMvp } from "./startup-founder-build-mvp.js";
export { startupOnboard } from "./startup-founder-onboard.js";
export {
  formatStartupDependencyApprovalBoundary,
  resolveStartupDependencyApprovalBoundary,
  type StartupDependencyApprovalBoundary,
  type StartupDependencyApprovalPolicy
} from "./startup-dependency-approval.js";
export {
  formatStartupBuildMvp,
  formatStartupLaunchCheck,
  formatStartupOnboard,
  formatStartupScaleCheck
} from "./startup-founder-format.js";
export {
  formatStartupWorkerGovernanceNotice,
  resolveStartupWorkerGovernance,
  type ResolvedStartupWorkerGovernance,
  type ResolvedStartupWorkerGovernanceProfile,
  type StartupWorkerGovernanceProfile
} from "./startup-worker-governance.js";
export type {
  StartupBuildMvpAttempt,
  StartupBuildMvpOptions,
  StartupBuildMvpResult,
  StartupFounderFlowOptions,
  StartupGeneratedStep,
  StartupLaunchCheckResult,
  StartupMvpVerifierRun,
  StartupMvpVerifierTaskStatus,
  StartupOnboardResult,
  StartupScaleCheckResult
} from "./startup-founder-types.js";

export async function startupLaunchCheck(
  options: StartupFounderFlowOptions = {}
): Promise<StartupLaunchCheckResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const target = options.target ?? "production";
  await initStartup({
    cwd,
    stage: "launch",
    profile: options.profile ?? "trusted-local",
    force: false,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  const readiness = await generateRepoReadinessAudit({
    cwd,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const security = await generateSecurityBaseline({
    cwd,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const gate = await checkStartupGate({
    cwd,
    stage: "launch",
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const readinessBlockers =
    target === "local"
      ? readiness.blockers.filter(
          (blocker) => blocker !== "CI configuration is missing"
        )
      : readiness.blockers;
  const report = await generateLaunchReadinessReport({
    cwd,
    target,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: readiness.root,
    readiness: {
      ...readiness,
      blockers: readinessBlockers
    },
    security,
    gate,
    reportPath: report.reportPath,
    status: report.status,
    blockers: report.blockers,
    nextCommands:
      report.status === "launch_ready"
        ? ["runstead startup scale-check"]
        : ["runstead startup remediate --stage launch --execute --worker codex_cli"]
  };
}

export async function startupScaleCheck(
  options: StartupFounderFlowOptions = {}
): Promise<StartupScaleCheckResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  await initStartup({
    cwd,
    stage: "scale",
    profile: options.profile ?? "trusted-local",
    force: false,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  const opsReport = await generateScaleOpsReport({
    cwd,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const gate = await checkStartupGate({
    cwd,
    stage: "scale",
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: opsReport.root,
    opsReport,
    gate,
    nextCommands: gate.passed
      ? ["runstead startup scale report"]
      : ["runstead startup remediate --stage scale --execute --worker codex_cli"]
  };
}
