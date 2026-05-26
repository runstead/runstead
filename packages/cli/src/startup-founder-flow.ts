import { resolve } from "node:path";

import { createLocalAgentTask, runLocalAgentTask } from "./local-agent.js";
import { generateLaunchReadinessReport } from "./launch-readiness-report.js";
import {
  normalizeStartupBuildMvpMaxAttempts,
  normalizeStartupBuildMvpMaxTurns,
  startupBuildMvpPromptWithDependencyBoundary,
  startupBuildMvpRetryPrompt,
  startupMvpVerifierRunPassed,
  verifierCommands,
  verifierRunFromLocalAgentRun
} from "./startup-build-mvp-helpers.js";
import { resolveStartupDependencyApprovalBoundary } from "./startup-dependency-approval.js";
import {
  generateRepoReadinessAudit,
  generateScaleOpsReport,
  generateSecurityBaseline,
  initStartup
} from "./startup-automation.js";
import { checkStartupGate } from "./startup-evidence.js";
import { resolveStartupScaffoldProfile } from "./startup-scaffold-profile.js";
import type {
  StartupBuildMvpAttempt,
  StartupBuildMvpOptions,
  StartupBuildMvpResult,
  StartupFounderFlowOptions,
  StartupLaunchCheckResult,
  StartupScaleCheckResult
} from "./startup-founder-types.js";

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

export async function startupBuildMvp(
  options: StartupBuildMvpOptions = {}
): Promise<StartupBuildMvpResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const worker = options.worker ?? "codex_cli";
  const maxAttempts = normalizeStartupBuildMvpMaxAttempts(options.maxAttempts);
  const maxTurns = normalizeStartupBuildMvpMaxTurns(options.maxTurns);
  const dependencyApproval = resolveStartupDependencyApprovalBoundary({
    ...(options.dependencyPolicy === undefined
      ? {}
      : { policy: options.dependencyPolicy }),
    allowedDependencies: options.allowedDependencies ?? []
  });
  const scaffoldProfile =
    options.scaffoldProfile ??
    resolveStartupScaffoldProfile({
      ...(options.appTemplate === undefined ? {} : { template: options.appTemplate }),
      ...(options.appType === undefined ? {} : { appType: options.appType })
    });
  const basePrompt = await startupBuildMvpPromptWithDependencyBoundary({
    cwd,
    ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
    ...(scaffoldProfile === undefined ? {} : { scaffoldProfile }),
    dependencyApproval
  });
  const init = await initStartup({
    cwd,
    stage: "mvp",
    profile: options.profile ?? "trusted-local",
    force: false,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const attempts: StartupBuildMvpAttempt[] = [];
  let prompt = basePrompt;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const created = await createLocalAgentTask({
      cwd,
      title:
        maxAttempts === 1
          ? "Build startup MVP"
          : `Build startup MVP (attempt ${attempt}/${maxAttempts})`,
      prompt,
      worker,
      mode: "repair",
      checkpoint: true,
      approvalRequired: dependencyApproval.approvalRequired,
      verifierCommands: await verifierCommands(cwd, options.now),
      maxTurns,
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(scaffoldProfile === undefined ? {} : { scaffoldProfile }),
      ...(options.now === undefined ? {} : { now: options.now })
    });
    const run = await runLocalAgentTask({
      cwd,
      taskId: created.task.id,
      ...(options.workerRunner === undefined
        ? {}
        : { workerRunner: options.workerRunner }),
      ...(options.workerProgressIntervalMs === undefined
        ? {}
        : { workerProgressIntervalMs: options.workerProgressIntervalMs }),
      ...(options.onWorkerProgress === undefined
        ? {}
        : { onWorkerProgress: options.onWorkerProgress }),
      ...(options.now === undefined ? {} : { now: options.now })
    });
    const verifierRun = verifierRunFromLocalAgentRun(run);
    const currentAttempt: StartupBuildMvpAttempt = {
      attempt,
      localAgentTaskId: created.task.id,
      status: run.status,
      summary: run.summary,
      execution: run.execution,
      verifierRun
    };

    attempts.push(currentAttempt);

    if (
      (run.status !== "completed" && verifierRun.status === "skipped") ||
      startupMvpVerifierRunPassed(verifierRun) ||
      attempt === maxAttempts
    ) {
      break;
    }

    prompt = startupBuildMvpRetryPrompt({
      basePrompt,
      attempt,
      maxAttempts,
      verifierRun
    });
  }

  const finalAttempt = attempts.at(-1);

  if (finalAttempt === undefined) {
    throw new Error("Startup MVP build did not run any attempts");
  }

  const gate = await checkStartupGate({
    cwd,
    stage: "mvp",
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: init.root,
    worker,
    localAgentTaskId: finalAttempt.localAgentTaskId,
    status: finalAttempt.status,
    summary: finalAttempt.summary,
    execution: finalAttempt.execution,
    maxTurns,
    dependencyApproval,
    verifierRun: finalAttempt.verifierRun,
    attempts,
    gate,
    nextCommands: [
      "runstead startup launch-check",
      "runstead startup remediate --stage launch --execute --worker codex_cli"
    ]
  };
}

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
