import {
  resolveRuntimeBackendSelection,
  type RuntimeBackendConfigEnv,
  type RuntimeBackendSelection
} from "@runstead/runtime";

import { resolveRunsteadRoot } from "../runstead-root.js";
import { emitStartupReadyPhaseResult, emitStartupReadyProgress } from "./progress.js";
import { writeStartupReadinessRun } from "./run-state.js";
import {
  collectRunEvidence,
  errorMessage,
  shouldRunPhase,
  updatePhase
} from "./shared.js";
import type {
  StartupReadinessRun,
  StartupReadyOptions,
  StartupReadyPlanRuntimeBackendLiveCheck
} from "./types.js";

export interface StartupReadyRuntimeBackendPlan {
  backend: string;
  storageUri: string;
  artifactBaseUri?: string;
  setupBlockers: string[];
  warnings: string[];
  teamReady?: boolean;
  live?: StartupReadyPlanRuntimeBackendLiveCheck;
}

export function inspectStartupReadyRuntimeBackend(input: {
  cwd: string;
  rootPath: string;
  env?: RuntimeBackendConfigEnv;
  live?: boolean;
  liveMigrate?: boolean;
  schema?: string;
  postgresClientFactory?: StartupReadyOptions["runtimeBackendPostgresClientFactory"];
  now?: Date;
}): Promise<StartupReadyRuntimeBackendPlan> {
  return inspectStartupReadyRuntimeBackendInternal(input);
}

async function inspectStartupReadyRuntimeBackendInternal(input: {
  cwd: string;
  rootPath: string;
  env?: RuntimeBackendConfigEnv;
  live?: boolean;
  liveMigrate?: boolean;
  schema?: string;
  postgresClientFactory?: StartupReadyOptions["runtimeBackendPostgresClientFactory"];
  now?: Date;
}): Promise<StartupReadyRuntimeBackendPlan> {
  if (input.live === true) {
    return inspectStartupReadyLiveRuntimeBackendPlan({
      cwd: input.cwd,
      ...(input.env === undefined ? {} : { env: input.env }),
      liveMigrate: input.liveMigrate === true,
      ...(input.schema === undefined ? {} : { schema: input.schema }),
      ...(input.postgresClientFactory === undefined
        ? {}
        : { postgresClientFactory: input.postgresClientFactory }),
      ...(input.now === undefined ? {} : { now: input.now })
    });
  }

  try {
    const selection = resolveRuntimeBackendSelection({
      rootPath: input.rootPath,
      ...(input.env === undefined ? {} : { env: input.env }),
      ...(input.now === undefined ? {} : { now: input.now })
    });

    return startupReadyRuntimeBackendPlan(selection);
  } catch (error) {
    return {
      backend: "invalid",
      storageUri: "unresolved",
      setupBlockers: [errorMessage(error)],
      warnings: []
    };
  }
}

export async function executeStartupReadyRuntimeBackendPhase(
  run: StartupReadinessRun,
  options: StartupReadyOptions
): Promise<boolean> {
  if (!shouldRunPhase(run, "runtime_backend")) {
    return true;
  }

  updatePhase(run, "runtime_backend", { status: "running" });
  await writeStartupReadinessRun(run);
  emitStartupReadyProgress(run, options, {
    phaseId: "runtime_backend",
    status: "started",
    message: "checking selected runtime backend"
  });

  const root = await resolveRunsteadRoot(run.cwd);
  const plan = await inspectStartupReadyRuntimeBackend({
    cwd: run.cwd,
    rootPath: root.root,
    env: options.runtimeBackendEnv ?? process.env,
    live: options.runtimeBackendLive === true,
    liveMigrate: options.runtimeBackendMigrate === true,
    ...(options.runtimeBackendSchema === undefined
      ? {}
      : { schema: options.runtimeBackendSchema }),
    ...(options.runtimeBackendPostgresClientFactory === undefined
      ? {}
      : { postgresClientFactory: options.runtimeBackendPostgresClientFactory }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const passed = plan.setupBlockers.length === 0;

  run.runtimeBackend = plan;
  updatePhase(run, "runtime_backend", {
    status: passed ? "passed" : "blocked",
    blockers: plan.setupBlockers,
    warnings: plan.warnings,
    nextAction: passed
      ? `runtime backend ${plan.backend} is ready`
      : "fix runtime backend configuration and rerun startup ready"
  });
  collectRunEvidence(run);
  await writeStartupReadinessRun(run);
  emitStartupReadyPhaseResult(run, options, "runtime_backend");

  return passed;
}

function startupReadyRuntimeBackendPlan(
  selection: RuntimeBackendSelection
): StartupReadyRuntimeBackendPlan {
  return {
    backend: selection.backend,
    storageUri: selection.storage.stateUri,
    ...(selection.storage.artifactBaseUri === undefined
      ? {}
      : { artifactBaseUri: selection.storage.artifactBaseUri }),
    setupBlockers: selection.setupBlockers,
    warnings: selection.warnings,
    ...(selection.teamAssessment === undefined
      ? {}
      : { teamReady: selection.teamAssessment.passed })
  };
}

async function inspectStartupReadyLiveRuntimeBackendPlan(input: {
  cwd: string;
  env?: RuntimeBackendConfigEnv;
  liveMigrate?: boolean;
  schema?: string;
  postgresClientFactory?: StartupReadyOptions["runtimeBackendPostgresClientFactory"];
  now?: Date;
}): Promise<StartupReadyRuntimeBackendPlan> {
  const { checkTeamControlPlane } = await import("../team-control-plane.js");
  const result = await checkTeamControlPlane({
    cwd: input.cwd,
    ...(input.env === undefined ? {} : { env: input.env }),
    live: true,
    liveMigrate: input.liveMigrate === true,
    liveRequireInitialized: false,
    ...(input.schema === undefined ? {} : { schema: input.schema }),
    ...(input.postgresClientFactory === undefined
      ? {}
      : { postgresClientFactory: input.postgresClientFactory }),
    ...(input.now === undefined ? {} : { now: input.now })
  });
  const live = result.liveBackend;

  return {
    backend: result.backend,
    storageUri: result.storageUri,
    ...(result.artifactBaseUri === undefined
      ? {}
      : { artifactBaseUri: result.artifactBaseUri }),
    setupBlockers: result.setupBlockers,
    warnings: result.warnings,
    teamReady: result.passed,
    live: {
      enabled: true,
      connected: live?.connected === true,
      migrated: live?.migrated === true,
      ...(live?.schema === undefined ? {} : { schema: live.schema }),
      runnerCount: live?.runnerCount ?? 0,
      freshRunnerHeartbeats: live?.freshRunnerHeartbeats ?? 0,
      blockers: live?.blockers ?? []
    }
  };
}
