import { executeStartupReadinessExtensions } from "../startup-extension-execution.js";
import type { StartupReadinessRun, StartupReadyOptions } from "./types.js";
import {
  collectRunEvidence,
  shouldRunPhase,
  startupReadyStageToGateStage,
  updatePhase
} from "./shared.js";
import { emitStartupReadyPhaseResult, emitStartupReadyProgress } from "./progress.js";
import { writeStartupReadinessRun } from "./run-state.js";
import { startupReadyExtensionWarnings } from "./verifier-phase.js";

export async function executeStartupReadyExtensionsPhase(
  run: StartupReadinessRun,
  options: StartupReadyOptions
): Promise<void> {
  if (!shouldRunPhase(run, "extensions")) {
    return;
  }

  updatePhase(run, "extensions", { status: "running" });
  await writeStartupReadinessRun(run);
  emitStartupReadyProgress(run, options, {
    phaseId: "extensions",
    status: "started",
    message: "running extension collectors"
  });
  const extensions = await executeStartupReadinessExtensions({
    cwd: run.cwd,
    target: run.target,
    stage: startupReadyStageToGateStage(run.stage),
    worker: run.worker,
    governanceProfile: run.governanceProfile,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  updatePhase(run, "extensions", {
    status: extensions.status,
    evidenceIds: extensions.evidenceIds,
    artifacts: extensions.artifacts,
    blockers: extensions.blockers,
    warnings: startupReadyExtensionWarnings(extensions),
    nextAction:
      extensions.status === "passed"
        ? "continue launch readiness"
        : "resolve extension collector blockers and rerun startup ready"
  });
  collectRunEvidence(run);
  await writeStartupReadinessRun(run);
  emitStartupReadyPhaseResult(run, options, "extensions");
}
