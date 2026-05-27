import type { TeamControlPlaneCheckResult } from "./team-control-plane.js";

export function formatTeamControlPlaneCheck(
  result: TeamControlPlaneCheckResult
): string {
  return [
    "Runstead Team Control Plane Check",
    "",
    `Workspace: ${result.cwd}`,
    `State root: ${result.root}`,
    `Initialized: ${result.initialized ? "yes" : "no"}`,
    `Backend: ${result.backend}`,
    `Storage: ${result.storageUri}`,
    ...(result.artifactBaseUri === undefined
      ? []
      : [`Artifacts: ${result.artifactBaseUri}`]),
    ...(result.liveBackend === undefined
      ? []
      : [
          `Live backend: ${result.liveBackend.connected ? "connected" : "blocked"}${result.liveBackend.schema === undefined ? "" : ` schema=${result.liveBackend.schema}`} migrated=${result.liveBackend.migrated ? "yes" : "no"} runners=${result.liveBackend.runnerCount} fresh=${result.liveBackend.freshRunnerHeartbeats}`
        ]),
    `Status: ${result.passed ? "ready" : "blocked"}`,
    "",
    "Assertions:",
    ...result.assertions.map(
      (assertion) =>
        `- ${assertion.status.toUpperCase()} ${assertion.id}: ${assertion.message}`
    ),
    ...(result.setupBlockers.length === 0
      ? []
      : ["", "Setup blockers:", ...result.setupBlockers.map((item) => `- ${item}`)]),
    ...(result.warnings.length === 0
      ? []
      : ["", "Warnings:", ...result.warnings.map((item) => `- ${item}`)]),
    ...(result.nextActions.length === 0
      ? []
      : ["", "Next actions:", ...result.nextActions.map((item) => `- ${item}`)]),
    ""
  ].join("\n");
}
