import type {
  RuntimeBackendConfigEnv,
  RuntimeRunnerRegistration
} from "@runstead/runtime";

import type { TeamControlPlanePostgresClientFactory } from "./team-control-plane-runner.js";

export interface TeamControlPlaneCheckLiveBackend {
  enabled: boolean;
  migrated: boolean;
  connected: boolean;
  schema?: string;
  runnerCount: number;
  freshRunnerHeartbeats: number;
  blockers: string[];
}

export interface InspectedLiveTeamControlPlaneBackend {
  connected: boolean;
  migrated: boolean;
  schema?: string;
  runners: RuntimeRunnerRegistration[];
  blockers: string[];
}

export interface InspectLiveTeamControlPlaneBackendOptions {
  cwd: string;
  env: RuntimeBackendConfigEnv;
  migrate: boolean;
  requireInitialized: boolean;
  schema?: string;
  postgresClientFactory?: TeamControlPlanePostgresClientFactory;
}

export interface LiveTeamControlPlaneAssertion {
  id: string;
  title: string;
  status: "pass" | "fail";
  message: string;
  evidence: string[];
}

export async function inspectLiveTeamControlPlaneBackend(
  input: InspectLiveTeamControlPlaneBackendOptions
): Promise<InspectedLiveTeamControlPlaneBackend> {
  const { checkTeamControlPlaneLiveBackend } =
    await import("./team-control-plane-runner.js");

  try {
    const result = await checkTeamControlPlaneLiveBackend({
      cwd: input.cwd,
      env: input.env,
      migrate: input.migrate,
      requireInitialized: input.requireInitialized,
      ...(input.schema === undefined ? {} : { schema: input.schema }),
      ...(input.postgresClientFactory === undefined
        ? {}
        : { postgresClientFactory: input.postgresClientFactory })
    });

    return {
      connected: true,
      migrated: result.migrated,
      schema: result.schema,
      runners: result.runners,
      blockers: []
    };
  } catch (error) {
    return {
      connected: false,
      migrated: false,
      ...(input.schema === undefined ? {} : { schema: input.schema }),
      runners: [],
      blockers: [`live Postgres backend check failed: ${errorMessage(error)}`]
    };
  }
}

export function envWithLiveRunnerHeartbeats(
  env: RuntimeBackendConfigEnv,
  runners: RuntimeRunnerRegistration[]
): RuntimeBackendConfigEnv {
  const activeRunners = runners.filter((runner) => runner.status === "active");
  const runnerIds = activeRunners.map((runner) => runner.runnerId).join(",");
  const lastSeenAt = activeRunners
    .filter((runner) => runner.lastSeenAt !== undefined)
    .map((runner) => `${runner.runnerId}=${runner.lastSeenAt}`)
    .join(",");

  return {
    ...env,
    ...(runnerIds.length === 0 ? {} : { RUNSTEAD_RUNNER_ID: runnerIds }),
    ...(lastSeenAt.length === 0 ? {} : { RUNSTEAD_RUNNER_LAST_SEEN_AT: lastSeenAt })
  };
}

export function liveTeamControlPlaneAssertions(
  live: InspectedLiveTeamControlPlaneBackend
): LiveTeamControlPlaneAssertion[] {
  return [
    {
      id: "postgres-live-backend",
      title: "Live Postgres backend",
      status: live.connected ? "pass" : "fail",
      message: live.connected
        ? `connected to Postgres backend and read ${live.runners.length} runner(s)`
        : (live.blockers[0] ?? "live Postgres backend check failed"),
      evidence: live.connected
        ? [
            `schema=${live.schema ?? "runstead"}`,
            `migrated=${live.migrated ? "yes" : "no"}`,
            `runners=${live.runners.length}`
          ]
        : []
    }
  ];
}

export function liveTeamControlPlaneCheckSnapshot(
  live: InspectedLiveTeamControlPlaneBackend,
  now: Date
): TeamControlPlaneCheckLiveBackend {
  return {
    enabled: true,
    migrated: live.migrated,
    connected: live.connected,
    ...(live.schema === undefined ? {} : { schema: live.schema }),
    runnerCount: live.runners.length,
    freshRunnerHeartbeats: liveBackendFreshRunnerHeartbeats(live.runners, now),
    blockers: live.blockers
  };
}

function liveBackendFreshRunnerHeartbeats(
  runners: RuntimeRunnerRegistration[],
  now: Date
): number {
  const ttlMs = 30_000;

  return runners.filter((runner) => {
    if (runner.status !== "active" || runner.lastSeenAt === undefined) {
      return false;
    }

    const parsed = Date.parse(runner.lastSeenAt);

    return Number.isFinite(parsed) && now.getTime() - parsed <= ttlMs;
  }).length;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
