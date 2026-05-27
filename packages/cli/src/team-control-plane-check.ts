import { resolve } from "node:path";

import {
  resolveRuntimeBackendSelection,
  type RuntimeBackendSelection
} from "@runstead/runtime";

import { resolveRunsteadRoot } from "./runstead-root.js";
import {
  teamControlPlaneAssertions,
  teamControlPlaneNextActions
} from "./team-control-plane-assessment.js";
import {
  envWithLiveRunnerHeartbeats,
  inspectLiveTeamControlPlaneBackend,
  liveTeamControlPlaneAssertions,
  liveTeamControlPlaneCheckSnapshot
} from "./team-control-plane-live.js";
import type {
  TeamControlPlaneCheckOptions,
  TeamControlPlaneCheckResult
} from "./team-control-plane-types.js";

export async function checkTeamControlPlane(
  options: TeamControlPlaneCheckOptions = {}
): Promise<TeamControlPlaneCheckResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const root = await resolveRunsteadRoot(cwd);
  const env = options.env ?? process.env;
  const liveBackend =
    options.live === true
      ? await inspectLiveTeamControlPlaneBackend({
          cwd,
          env,
          migrate: options.liveMigrate === true,
          requireInitialized: options.liveRequireInitialized !== false,
          ...(options.schema === undefined ? {} : { schema: options.schema }),
          ...(options.postgresClientFactory === undefined
            ? {}
            : { postgresClientFactory: options.postgresClientFactory })
        })
      : undefined;
  const effectiveEnv =
    liveBackend?.connected === true && liveBackend.runners.length > 0
      ? envWithLiveRunnerHeartbeats(env, liveBackend.runners)
      : env;
  let selection: RuntimeBackendSelection | undefined;
  let selectionError: string | undefined;

  try {
    selection = resolveRuntimeBackendSelection({
      rootPath: root.root,
      env: effectiveEnv,
      ...(options.now === undefined ? {} : { now: options.now })
    });
  } catch (error) {
    selectionError = errorMessage(error);
  }

  const assertions = teamControlPlaneAssertions({
    env: effectiveEnv,
    rootSource: root.source,
    ...(selection === undefined ? {} : { selection }),
    ...(selectionError === undefined ? {} : { selectionError })
  });
  if (liveBackend !== undefined) {
    assertions.push(...liveTeamControlPlaneAssertions(liveBackend));
  }
  const setupBlockers = [
    ...(selection?.setupBlockers ?? []),
    ...(selectionError === undefined ? [] : [selectionError]),
    ...(liveBackend?.blockers ?? [])
  ];
  const warnings = selection?.warnings ?? [];
  const nextActions = teamControlPlaneNextActions(assertions, setupBlockers);
  const passed =
    assertions.every((assertion) => assertion.status !== "fail") &&
    setupBlockers.length === 0;

  return {
    cwd: root.cwd,
    root: root.root,
    initialized: root.source !== "missing",
    backend: selection?.backend ?? "invalid",
    storageUri: selection?.storage.stateUri ?? "unresolved",
    ...(selection?.storage.artifactBaseUri === undefined
      ? {}
      : { artifactBaseUri: selection.storage.artifactBaseUri }),
    passed,
    assertions,
    setupBlockers,
    warnings,
    nextActions,
    ...(liveBackend === undefined
      ? {}
      : {
          liveBackend: liveTeamControlPlaneCheckSnapshot(
            liveBackend,
            options.now ?? new Date()
          )
        })
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
