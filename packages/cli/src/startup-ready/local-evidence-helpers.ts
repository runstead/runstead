import type { StartupReadinessRun } from "./types.js";

export function gateNeedsBaselineEvidence(
  blockers: string[],
  ...needles: string[]
): boolean {
  const loweredNeedles = needles.map((needle) => needle.toLowerCase());

  return blockers.some((blocker) => {
    const lowered = blocker.toLowerCase();

    return loweredNeedles.every((needle) => lowered.includes(needle));
  });
}

export function localStartupReadySource(
  runId: string,
  now: Date,
  kind: "manual" | "local_command"
): {
  kind: string;
  uri: string;
  capturedAt: string;
  freshnessDays: number;
  trustLevel: string;
} {
  return {
    kind,
    uri: `startup-ready:${runId}:${kind}`,
    capturedAt: now.toISOString(),
    freshnessDays: 14,
    trustLevel: "low"
  };
}

export function phaseStatusForEvidence(
  run: StartupReadinessRun,
  phaseId: string
): string {
  return run.phases.find((phase) => phase.id === phaseId)?.status ?? "not_included";
}
