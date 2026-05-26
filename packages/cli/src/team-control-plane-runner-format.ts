import type {
  TeamControlPlaneRunnerHeartbeatResult,
  TeamControlPlaneRunnerListResult
} from "./team-control-plane-runner.js";

export function formatTeamControlPlaneRunnerHeartbeat(
  result: TeamControlPlaneRunnerHeartbeatResult
): string {
  return [
    "Runstead Team Runner Heartbeat",
    "",
    `Backend: ${result.backend}`,
    `Storage: ${result.storageUri}`,
    `Schema: ${result.schema}`,
    `Migrated: ${result.migrated ? "yes" : "no"}`,
    `Runner: ${result.runner.runnerId}`,
    ...(result.runner.organizationId === undefined
      ? []
      : [`Organization: ${result.runner.organizationId}`]),
    ...(result.runner.workspaceId === undefined
      ? []
      : [`Workspace: ${result.runner.workspaceId}`]),
    `Status: ${result.runner.status}`,
    `Last seen: ${result.runner.lastSeenAt ?? "unknown"}`,
    `Labels: ${result.runner.labels.join(", ") || "none"}`,
    ""
  ].join("\n");
}

export function formatTeamControlPlaneRunnerList(
  result: TeamControlPlaneRunnerListResult
): string {
  return [
    "Runstead Team Runners",
    "",
    `Backend: ${result.backend}`,
    `Storage: ${result.storageUri}`,
    `Schema: ${result.schema}`,
    `Count: ${result.runners.length}`,
    "",
    ...result.runners.map(
      (runner) =>
        `- ${runner.runnerId} ${runner.status} last_seen=${runner.lastSeenAt ?? "unknown"} labels=${runner.labels.join(",") || "none"}`
    ),
    ""
  ].join("\n");
}
