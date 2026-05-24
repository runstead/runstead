import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createReadinessRunSnapshotEvent } from "@runstead/runtime";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDb, resolveRunsteadRoot } from "../runstead-root.js";
import type { PersistedStartupReadinessRun, StartupReadinessRun } from "./types.js";
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
      event: createReadinessRunSnapshotEvent(run, { path })
    });
  } finally {
    database.close();
  }
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
