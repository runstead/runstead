import type {
  StartupReadinessPhaseStatus,
  StartupReadinessRun,
  StartupReadyOptions,
  StartupReadyProgressEvent,
  StartupReadyProgressEventStatus
} from "./types.js";

export function emitStartupReadyPhaseResult(
  run: StartupReadinessRun,
  options: StartupReadyOptions,
  phaseId: string
): void {
  const phase = run.phases.find((item) => item.id === phaseId);

  if (phase === undefined) {
    return;
  }

  emitStartupReadyProgress(run, options, {
    phaseId,
    status: startupReadyProgressStatusForPhase(phase.status),
    message: `${phase.title} ${phase.status}`,
    evidenceIds: phase.evidenceIds,
    artifacts: phase.artifacts,
    blockers: phase.blockers
  });
}

export function emitStartupReadyProgress(
  run: StartupReadinessRun,
  options: StartupReadyOptions,
  event: Omit<StartupReadyProgressEvent, "runId" | "timestamp" | "phaseTitle">
): void {
  const phase =
    event.phaseId === undefined
      ? undefined
      : run.phases.find((item) => item.id === event.phaseId);

  options.onProgress?.({
    runId: run.id,
    ...(event.phaseId === undefined ? {} : { phaseId: event.phaseId }),
    ...(phase === undefined ? {} : { phaseTitle: phase.title }),
    status: event.status,
    message: event.message,
    timestamp: (options.now ?? new Date()).toISOString(),
    ...(event.evidenceIds === undefined ? {} : { evidenceIds: event.evidenceIds }),
    ...(event.artifacts === undefined ? {} : { artifacts: event.artifacts }),
    ...(event.blockers === undefined ? {} : { blockers: event.blockers })
  });
}

export function startupReadyProgressStatusForPhase(
  status: StartupReadinessPhaseStatus
): StartupReadyProgressEventStatus {
  if (status === "passed") {
    return "completed";
  }

  if (status === "blocked") {
    return "blocked";
  }

  if (status === "failed") {
    return "failed";
  }

  if (status === "skipped") {
    return "skipped";
  }

  return "started";
}
