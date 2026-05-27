import {
  parseLocalAgentWorker,
  parsePositiveInteger
} from "../startup-command-parsers.js";
import {
  formatWorkerProcessProgress,
  type WorkerProcessProgress
} from "../wrapped-worker.js";

export interface StartupFounderOnboardCommandOptions {
  cwd?: string;
  profile: "default" | "trusted-local";
  force?: boolean;
  writeCi?: boolean;
}

export interface StartupFounderBuildMvpCommandOptions {
  cwd?: string;
  worker: string;
  model?: string;
  prompt?: string;
  dependencyPolicy: string;
  allowDependency: string[];
  maxAttempts: string;
  maxTurns: string;
}

export interface StartupFounderCheckCommandOptions {
  cwd?: string;
}

export async function runStartupFounderOnboardCommand(
  options: StartupFounderOnboardCommandOptions
): Promise<void> {
  const { formatStartupOnboard, startupOnboard } =
    await import("../startup-founder-flow.js");
  const result = await startupOnboard({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    profile: options.profile,
    force: options.force === true,
    writeCi: options.writeCi === true
  });

  console.log(formatStartupOnboard(result));
}

export async function runStartupFounderBuildMvpCommand(
  options: StartupFounderBuildMvpCommandOptions
): Promise<void> {
  const {
    formatStartupDependencyApprovalBoundary,
    formatStartupBuildMvp,
    formatStartupWorkerGovernanceNotice,
    resolveStartupDependencyApprovalBoundary,
    startupBuildMvp
  } = await import("../startup-founder-flow.js");
  const worker = parseLocalAgentWorker(options.worker);
  const dependencyApproval = resolveStartupDependencyApprovalBoundary({
    policy: options.dependencyPolicy,
    allowedDependencies: options.allowDependency
  });

  console.log(formatStartupWorkerGovernanceNotice(worker));
  console.log(
    `Dependency policy: ${formatStartupDependencyApprovalBoundary(dependencyApproval)}`
  );
  const result = await startupBuildMvp({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    worker,
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
    dependencyPolicy: dependencyApproval.policy,
    allowedDependencies: dependencyApproval.allowedDependencies,
    maxAttempts: parsePositiveInteger(options.maxAttempts, "--max-attempts"),
    maxTurns: parsePositiveInteger(options.maxTurns, "--max-turns"),
    onWorkerProgress: logWrappedWorkerProgress
  });

  console.log(formatStartupBuildMvp(result));
}

export async function runStartupFounderLaunchCheckCommand(
  options: StartupFounderCheckCommandOptions
): Promise<void> {
  const { formatStartupLaunchCheck, startupLaunchCheck } =
    await import("../startup-founder-flow.js");
  const result = await startupLaunchCheck({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd })
  });

  console.log(formatStartupLaunchCheck(result));
}

export async function runStartupFounderScaleCheckCommand(
  options: StartupFounderCheckCommandOptions
): Promise<void> {
  const { formatStartupScaleCheck, startupScaleCheck } =
    await import("../startup-founder-flow.js");
  const result = await startupScaleCheck({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd })
  });

  console.log(formatStartupScaleCheck(result));
}

function logWrappedWorkerProgress(progress: WorkerProcessProgress): void {
  console.error(formatWorkerProcessProgress(progress));
}
