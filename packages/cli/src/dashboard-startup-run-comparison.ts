import type {
  DashboardStartupResolvedBlocker,
  DashboardStartupRun,
  DashboardStartupRunComparison,
  DashboardStartupRunSummary,
  DashboardStartupTimelineItem
} from "./dashboard-types.js";

export function dashboardStartupRunComparison(runs: DashboardStartupRun[]): {
  runComparison?: DashboardStartupRunComparison;
} {
  const latestCompleted = runs.find((run) => run.status === "completed");
  const latestBlocked = runs.find(
    (run) => run.id !== latestCompleted?.id && startupRunBlockedOrInterrupted(run)
  );

  if (latestCompleted === undefined && latestBlocked === undefined) {
    return {};
  }

  const completedBlockers = new Set(latestCompleted?.blockers ?? []);
  const blockedBlockers = new Set(latestBlocked?.blockers ?? []);
  const resolvedBlockers =
    latestCompleted === undefined
      ? []
      : [...blockedBlockers].filter((blocker) => !completedBlockers.has(blocker));
  const stillBlocked = [...blockedBlockers].filter((blocker) =>
    completedBlockers.has(blocker)
  );
  const resolvedBlockerDetails = dashboardStartupResolvedBlockerDetails({
    latestCompleted,
    latestBlocked,
    resolvedBlockers
  });

  return {
    runComparison: {
      ...(latestCompleted === undefined
        ? {}
        : { latestCompleted: dashboardStartupRunSummary(latestCompleted) }),
      ...(latestBlocked === undefined
        ? {}
        : { latestBlocked: dashboardStartupRunSummary(latestBlocked) }),
      resolvedBlockers,
      resolvedBlockerDetails,
      stillBlocked,
      narrative: startupRunComparisonNarrative({
        latestCompleted,
        latestBlocked,
        resolvedBlockers,
        stillBlocked
      })
    }
  };
}

function startupRunBlockedOrInterrupted(run: DashboardStartupRun): boolean {
  return (
    run.status === "blocked" ||
    run.status === "failed" ||
    run.status === "interrupted" ||
    run.verdict.endsWith("_blocked") ||
    run.blockers.length > 0
  );
}

function dashboardStartupRunSummary(
  run: DashboardStartupRun
): DashboardStartupRunSummary {
  return {
    id: run.id,
    status: run.status,
    verdict: run.verdict,
    target: run.target,
    ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
    ...(run.completedAt === undefined ? {} : { completedAt: run.completedAt }),
    blockerCount: run.blockers.length,
    phaseStatuses: run.timeline.map((item) => ({
      phase: item.phase,
      status: item.status
    }))
  };
}

function dashboardStartupResolvedBlockerDetails(input: {
  latestCompleted: DashboardStartupRun | undefined;
  latestBlocked: DashboardStartupRun | undefined;
  resolvedBlockers: string[];
}): DashboardStartupResolvedBlocker[] {
  if (input.latestCompleted === undefined || input.latestBlocked === undefined) {
    return [];
  }

  const completedByPhase = new Map(
    input.latestCompleted.timeline.map((item) => [item.phase, item])
  );

  return input.resolvedBlockers.map((blocker) => {
    const blockedPhases = input.latestBlocked?.timeline.filter((item) =>
      item.blockers.includes(blocker)
    );
    const phases = [...new Set(blockedPhases?.map((item) => item.phase) ?? [])];
    const completedPhases = phases
      .map((phase) => completedByPhase.get(phase))
      .filter((item): item is DashboardStartupTimelineItem => item !== undefined);
    const evidenceIds = [
      ...new Set(completedPhases.flatMap((item) => item.evidenceIds))
    ];
    const artifacts = [...new Set(completedPhases.flatMap((item) => item.artifacts))];
    const successfulPhase = completedPhases.find((item) => item.status === "passed");
    const resolution =
      successfulPhase === undefined
        ? phases.length === 0
          ? "Resolved in the latest completed run; no matching phase was recorded."
          : `Resolved in the latest completed run after phase(s): ${phases.join(", ")}.`
        : `Resolved by phase ${successfulPhase.title} with status ${successfulPhase.status}.`;

    return {
      blocker,
      phases,
      evidenceIds,
      artifacts,
      resolution
    };
  });
}

function startupRunComparisonNarrative(input: {
  latestCompleted: DashboardStartupRun | undefined;
  latestBlocked: DashboardStartupRun | undefined;
  resolvedBlockers: string[];
  stillBlocked: string[];
}): string {
  if (input.latestCompleted !== undefined && input.latestBlocked !== undefined) {
    return `Latest completed run ${input.latestCompleted.id} is compared with blocked/interrupted run ${input.latestBlocked.id}; ${input.resolvedBlockers.length} blocker(s) resolved and ${input.stillBlocked.length} blocker(s) still shared.`;
  }

  if (input.latestCompleted !== undefined) {
    return `Latest completed run ${input.latestCompleted.id} has no blocked/interrupted run to compare.`;
  }

  return `Latest blocked/interrupted run ${input.latestBlocked?.id ?? "unknown"} has no completed recovery run yet.`;
}
