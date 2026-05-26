import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { recoverStaleRunningTasks } from "../resume.js";
import { planStartupReady } from "./plan.js";
import { writeStartupReadinessRun } from "./run-state.js";
import { collectStartupReadyCodeState } from "./shared.js";
import type {
  PersistedStartupReadinessRun,
  StartupReadinessRun,
  StartupReadyOptions
} from "./types.js";

export async function recoverStartupReadyStaleTasks(
  options: StartupReadyOptions = {}
): Promise<void> {
  try {
    await recoverStaleRunningTasks({
      cwd: resolve(options.cwd ?? process.cwd()),
      ...(options.now === undefined ? {} : { now: options.now })
    });
  } catch (error) {
    if (!isMissingRunsteadStateError(error)) {
      throw error;
    }
  }
}

export async function createStartupReadinessRun(
  options: StartupReadyOptions = {}
): Promise<PersistedStartupReadinessRun> {
  const plan = await planStartupReady(options);
  const startedAt = (options.now ?? new Date()).toISOString();
  const codeState = await collectStartupReadyCodeState(plan.cwd);
  const run: StartupReadinessRun = {
    schemaVersion: 1,
    id: `run_${randomUUID().replaceAll("-", "")}`,
    cwd: plan.cwd,
    stage: plan.stage,
    target: plan.target,
    worker: plan.worker,
    governanceProfile: plan.governanceProfile,
    ...(plan.scaffoldProfile === undefined
      ? {}
      : { scaffoldProfile: plan.scaffoldProfile }),
    runtimeBackend: plan.runtimeBackend,
    status: "planned",
    phases: plan.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      status: phase.status,
      evidenceIds: [],
      artifacts: [],
      blockers: phase.blockers,
      ...(phase.nextAction === undefined ? {} : { nextAction: phase.nextAction })
    })),
    evidenceIds: [],
    evidenceTiers: [],
    evidenceTypes: [],
    evidenceRequirements: [],
    staleEvidenceRefs: [],
    supersededEvidenceRefs: [],
    verdict: "not_evaluated",
    verdictBlockers: [],
    reportPaths: [],
    guidedFlow: [],
    operatorCommands: [],
    startedAt,
    ...(codeState.gitHead === undefined ? {} : { gitHead: codeState.gitHead }),
    dirtyState: codeState.dirtyState,
    dirtyBreakdown: codeState.dirtyBreakdown,
    codeFingerprint: codeState.fingerprint
  };

  return writeStartupReadinessRun(run);
}

function isMissingRunsteadStateError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("Runstead is not initialized") ||
    message.includes("Runstead state database is missing")
  );
}
