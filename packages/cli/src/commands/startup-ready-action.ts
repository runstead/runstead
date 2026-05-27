import {
  parseLocalAgentWorker,
  parsePositiveInteger
} from "../startup-command-parsers.js";
import type { StartupReadyProgressEvent } from "../startup-ready.js";

export interface StartupReadyCommandOptions {
  cwd?: string;
  stage: string;
  target: string;
  worker?: string;
  governance: string;
  plan?: boolean;
  resume?: string;
  writeCi?: boolean;
  ci?: boolean;
  refreshContext?: boolean;
  writeTrackedContext?: boolean;
  interactive?: boolean;
  guided?: boolean;
  forceBuild?: boolean;
  repair?: boolean;
  liveRuntimeBackend?: boolean;
  migrateRuntimeBackend?: boolean;
  runtimeBackendSchema: string;
  appTemplate?: string;
  appType?: string;
  maxAttempts: string;
}

export async function runStartupReadyCommand(
  options: StartupReadyCommandOptions
): Promise<void> {
  const {
    formatStartupReadyProgress,
    formatStartupReadyPlan,
    formatStartupReadinessRun,
    parseStartupReadyStage,
    parseStartupReadyGovernanceProfile,
    parseStartupReadyTarget,
    planStartupReady,
    runStartupReady
  } = await import("../startup-ready.js");
  const { parseStartupAppType, parseStartupScaffoldTemplate } =
    await import("../startup-scaffold-profile.js");
  const target = parseStartupReadyTarget(options.target);
  const common = {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    stage: parseStartupReadyStage(options.stage),
    target,
    ...(options.worker === undefined
      ? {}
      : { worker: parseLocalAgentWorker(options.worker) }),
    governanceProfile: parseStartupReadyGovernanceProfile(options.governance),
    ...(options.resume === undefined ? {} : { resumeRunId: options.resume }),
    writeCi: options.writeCi === true,
    ci: options.ci === true,
    refreshContext: options.refreshContext === true,
    writeTrackedContext: options.writeTrackedContext === true,
    interactive: options.interactive === true,
    guided: options.guided === true,
    forceBuild: options.forceBuild === true || options.repair === true,
    runtimeBackendLive:
      options.liveRuntimeBackend === true || options.migrateRuntimeBackend === true,
    runtimeBackendMigrate: options.migrateRuntimeBackend === true,
    runtimeBackendSchema: options.runtimeBackendSchema,
    ...(options.appTemplate === undefined
      ? {}
      : { appTemplate: parseStartupScaffoldTemplate(options.appTemplate) }),
    ...(options.appType === undefined
      ? {}
      : { appType: parseStartupAppType(options.appType) }),
    maxAttempts: parsePositiveInteger(options.maxAttempts, "--max-attempts"),
    onProgress: (event: StartupReadyProgressEvent) => {
      console.error(formatStartupReadyProgress(event));
    }
  };

  if (options.plan === true) {
    console.log(formatStartupReadyPlan(await planStartupReady(common)));
    return;
  }

  const result = await runStartupReady(common);

  console.log(formatStartupReadinessRun(result.run));
}
