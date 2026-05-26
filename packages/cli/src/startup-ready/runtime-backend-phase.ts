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
import type { StartupReadinessRun, StartupReadyOptions } from "./types.js";

export interface StartupReadyRuntimeBackendPlan {
  backend: string;
  storageUri: string;
  artifactBaseUri?: string;
  setupBlockers: string[];
  warnings: string[];
  teamReady?: boolean;
}

export function inspectStartupReadyRuntimeBackend(input: {
  rootPath: string;
  env?: RuntimeBackendConfigEnv;
  now?: Date;
}): StartupReadyRuntimeBackendPlan {
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
  const plan = inspectStartupReadyRuntimeBackend({
    rootPath: root.root,
    env: options.runtimeBackendEnv ?? process.env,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const passed = plan.setupBlockers.length === 0;

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
