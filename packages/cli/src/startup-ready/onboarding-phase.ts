import { startupOnboard } from "../startup-founder-flow.js";
import {
  collectStartupReadyInteractiveAnswers,
  startupReadyInteractiveFounderFlowOptions
} from "./options.js";
import { emitStartupReadyPhaseResult, emitStartupReadyProgress } from "./progress.js";
import { writeStartupReadinessRun } from "./run-state.js";
import { collectRunEvidence, shouldRunPhase, updatePhase } from "./shared.js";
import type { StartupReadinessRun, StartupReadyOptions } from "./types.js";

export async function executeStartupReadyOnboardingPhase(
  run: StartupReadinessRun,
  options: StartupReadyOptions
): Promise<void> {
  if (
    !shouldRunPhase(run, "onboard") &&
    !shouldRunPhase(run, "context") &&
    !shouldRunPhase(run, "measurement")
  ) {
    return;
  }

  const interactiveAnswers = await collectStartupReadyInteractiveAnswers(options);

  updatePhase(run, "onboard", { status: "running" });
  await writeStartupReadinessRun(run);
  emitStartupReadyProgress(run, options, {
    phaseId: "onboard",
    status: "started",
    message: "initializing Runstead startup context and measurement"
  });
  const onboard = await startupOnboard({
    cwd: run.cwd,
    writeCi: options.writeCi === true,
    force: options.refreshContext === true,
    ...(options.writeTrackedContext === undefined
      ? {}
      : { writeTrackedContext: options.writeTrackedContext }),
    ...startupReadyInteractiveFounderFlowOptions(interactiveAnswers),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  updatePhase(run, "onboard", {
    status: "passed",
    artifacts: [
      ...onboard.onboardingFiles,
      ...(onboard.repo.ci.path === undefined ? [] : [onboard.repo.ci.path])
    ]
  });
  updatePhase(run, "context", {
    status: onboard.context.status === "generated" ? "passed" : "skipped",
    evidenceIds:
      onboard.context.result === undefined ? [] : [onboard.context.result.evidenceId],
    artifacts: onboard.context.result?.files ?? [],
    blockers:
      onboard.context.status === "generated"
        ? []
        : [onboard.context.reason ?? "context generation skipped"]
  });
  updatePhase(run, "measurement", {
    status: onboard.measurement.status === "generated" ? "passed" : "skipped",
    evidenceIds:
      onboard.measurement.result === undefined
        ? []
        : [onboard.measurement.result.evidenceId],
    artifacts: onboard.measurement.result?.files ?? [],
    blockers:
      onboard.measurement.status === "generated"
        ? []
        : [onboard.measurement.reason ?? "measurement generation skipped"]
  });
  collectRunEvidence(run);
  await writeStartupReadinessRun(run);
  emitStartupReadyPhaseResult(run, options, "onboard");
  emitStartupReadyPhaseResult(run, options, "context");
  emitStartupReadyPhaseResult(run, options, "measurement");
}
