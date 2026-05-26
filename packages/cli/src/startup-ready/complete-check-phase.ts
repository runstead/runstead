import {
  generateStartupCompleteProductCheck,
  type StartupCompleteProductCheckResult
} from "../startup-complete-check.js";
import { finalizeRun } from "./finalize.js";
import { emitStartupReadyPhaseResult, emitStartupReadyProgress } from "./progress.js";
import { startupCompleteProductArtifacts } from "./report-phase.js";
import { writeStartupReadinessRun } from "./run-state.js";
import { collectRunEvidence, shouldRunPhase, unique, updatePhase } from "./shared.js";
import type { StartupReadinessRun, StartupReadyOptions } from "./types.js";

export async function executeStartupReadyCompleteCheckPhase(
  run: StartupReadinessRun,
  options: StartupReadyOptions
): Promise<void> {
  if (!shouldRunPhase(run, "complete_check")) {
    return;
  }

  updatePhase(run, "complete_check", { status: "running" });
  await writeStartupReadinessRun(run);
  emitStartupReadyProgress(run, options, {
    phaseId: "complete_check",
    status: "started",
    message: "running complete product readiness check"
  });
  const provisional = await finalizeRun(run, options.now ?? new Date());
  const complete = await generateStartupCompleteProductCheck({
    cwd: run.cwd,
    target: run.target,
    readiness: {
      verdict: provisional.verdict,
      blockers: provisional.verdictBlockers
    },
    ...(options.now === undefined ? {} : { now: options.now })
  });

  updateCompleteCheckPhase(run, complete);
  collectRunEvidence(run);
  await writeStartupReadinessRun(run);
  emitStartupReadyPhaseResult(run, options, "complete_check");
}

function updateCompleteCheckPhase(
  run: StartupReadinessRun,
  complete: StartupCompleteProductCheckResult
): void {
  const completeArtifacts = startupCompleteProductArtifacts(complete);

  updatePhase(run, "complete_check", {
    status: complete.status === "complete" ? "passed" : "blocked",
    evidenceIds: [complete.evidenceId],
    artifacts: completeArtifacts,
    blockers: complete.criteria.flatMap((criterion) => criterion.missing),
    nextAction:
      complete.status === "complete"
        ? "ship with recorded evidence"
        : "resolve complete-product missing evidence and rerun startup ready"
  });
  run.reportPaths = unique([...run.reportPaths, ...completeArtifacts]);
}
