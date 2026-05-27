import type {
  StartupGateDiff,
  StartupGatePreviousEvent
} from "./startup-gate-types.js";

export function startupGateDiff(
  previous: StartupGatePreviousEvent | undefined,
  blockers: string[]
): StartupGateDiff {
  const previousBlockers = new Set(previous?.blockers ?? []);
  const currentBlockers = new Set(blockers);

  return {
    ...(previous === undefined ? {} : { previousEventId: previous.eventId }),
    addedBlockers: blockers.filter((blocker) => !previousBlockers.has(blocker)),
    resolvedBlockers: [...previousBlockers].filter(
      (blocker) => !currentBlockers.has(blocker)
    )
  };
}
