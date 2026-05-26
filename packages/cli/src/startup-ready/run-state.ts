import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createReadinessRunSnapshotEvent,
  type RuntimeReadinessRunSnapshot
} from "@runstead/runtime";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDb, resolveRunsteadRoot } from "../runstead-root.js";
import type {
  PersistedStartupReadinessRun,
  StartupReadinessRun,
  StartupReadyPlanRuntimeBackend
} from "./types.js";
import {
  startupReadinessRunsDir,
  startupReadinessRunGovernanceProfile
} from "./shared.js";
import {
  buildStartupReadyGuidedFlow,
  buildStartupReadyOperatorCommands
} from "./operator-actions.js";

export async function readStartupReadinessRun(input: {
  cwd?: string;
  runId: string;
}): Promise<PersistedStartupReadinessRun> {
  const cwd = resolve(input.cwd ?? process.cwd());
  const root = await resolveRunsteadRoot(cwd);
  const path = join(startupReadinessRunsDir(root.root), `${input.runId}.json`);
  const parsed = JSON.parse(await readFile(path, "utf8")) as StartupReadinessRun;

  return {
    run: withStartupReadinessGuidance({
      ...parsed,
      evidenceRequirements: parsed.evidenceRequirements ?? [],
      staleEvidenceRefs: parsed.staleEvidenceRefs ?? [],
      supersededEvidenceRefs: parsed.supersededEvidenceRefs ?? [],
      ...(typeof parsed.codeFingerprint === "string"
        ? { codeFingerprint: parsed.codeFingerprint }
        : {}),
      ...(parsed.runtimeBackend === undefined
        ? {}
        : { runtimeBackend: parsed.runtimeBackend }),
      governanceProfile: startupReadinessRunGovernanceProfile(parsed)
    }),
    path
  };
}

export async function writeStartupReadinessRun(
  run: StartupReadinessRun
): Promise<PersistedStartupReadinessRun> {
  const normalizedRun = withStartupReadinessGuidance(run);
  const root = await resolveRunsteadRoot(normalizedRun.cwd);
  const dir = startupReadinessRunsDir(root.root);
  const path = join(dir, `${normalizedRun.id}.json`);

  await mkdir(dir, { recursive: true });
  await writeFile(path, `${JSON.stringify(normalizedRun, null, 2)}\n`, "utf8");
  await recordStartupReadinessRunSnapshot(normalizedRun, path);

  return {
    run: normalizedRun,
    path
  };
}

export async function recordStartupReadinessRunSnapshot(
  run: StartupReadinessRun,
  path: string
): Promise<void> {
  let resolvedState: Awaited<ReturnType<typeof requireRunsteadStateDb>>;

  try {
    resolvedState = await requireRunsteadStateDb(run.cwd);
  } catch {
    return;
  }

  const database = openRunsteadDatabase(resolvedState.stateDb);

  try {
    appendEventAndProject(database, {
      event: createReadinessRunSnapshotEvent(readinessRunSnapshot(run), { path })
    });
  } finally {
    database.close();
  }
}

function readinessRunSnapshot(run: StartupReadinessRun): RuntimeReadinessRunSnapshot {
  return {
    schemaVersion: run.schemaVersion,
    id: run.id,
    cwd: run.cwd,
    stage: run.stage,
    target: run.target,
    worker: run.worker,
    governanceProfile: run.governanceProfile,
    ...(run.runtimeBackend === undefined
      ? {}
      : { runtimeBackend: runtimeBackendSnapshot(run.runtimeBackend) }),
    status: run.status,
    phases: run.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      status: phase.status,
      evidenceIds: phase.evidenceIds,
      artifacts: phase.artifacts,
      blockers: phase.blockers,
      ...(phase.nextAction === undefined ? {} : { nextAction: phase.nextAction })
    })),
    evidenceIds: run.evidenceIds,
    evidenceTiers: run.evidenceTiers,
    evidenceTypes: run.evidenceTypes,
    verdict: run.verdict,
    verdictBlockers: run.verdictBlockers,
    reportPaths: run.reportPaths,
    guidedFlow: run.guidedFlow,
    operatorCommands: run.operatorCommands,
    startedAt: run.startedAt,
    ...(run.completedAt === undefined ? {} : { completedAt: run.completedAt }),
    ...(run.gitHead === undefined ? {} : { gitHead: run.gitHead }),
    dirtyState: run.dirtyState,
    ...(run.codeFingerprint === undefined
      ? {}
      : { codeFingerprint: run.codeFingerprint })
  };
}

function runtimeBackendSnapshot(
  backend: StartupReadyPlanRuntimeBackend
): Record<string, unknown> {
  return {
    backend: backend.backend,
    storageUri: backend.storageUri,
    ...(backend.artifactBaseUri === undefined
      ? {}
      : { artifactBaseUri: backend.artifactBaseUri }),
    setupBlockers: backend.setupBlockers,
    warnings: backend.warnings,
    ...(backend.teamReady === undefined ? {} : { teamReady: backend.teamReady }),
    ...(backend.live === undefined
      ? {}
      : {
          live: {
            enabled: backend.live.enabled,
            connected: backend.live.connected,
            migrated: backend.live.migrated,
            ...(backend.live.schema === undefined
              ? {}
              : { schema: backend.live.schema }),
            runnerCount: backend.live.runnerCount,
            freshRunnerHeartbeats: backend.live.freshRunnerHeartbeats,
            blockers: backend.live.blockers
          }
        })
  };
}

export function withStartupReadinessGuidance(
  run: StartupReadinessRun
): StartupReadinessRun {
  const baseRun = {
    ...run,
    guidedFlow: [],
    operatorCommands: []
  };

  return {
    ...run,
    guidedFlow: buildStartupReadyGuidedFlow(baseRun),
    operatorCommands: buildStartupReadyOperatorCommands(baseRun)
  };
}
