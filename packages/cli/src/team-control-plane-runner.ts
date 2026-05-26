import type {
  RuntimeBackendConfigEnv,
  RuntimeRunnerRegistration
} from "@runstead/runtime";
import {
  createPostgresControlPlaneBackend,
  migratePostgresControlPlane,
  PsqlPostgresControlPlaneClient,
  type PostgresControlPlaneClient
} from "@runstead/state-postgres";

import { requireRunsteadRoot } from "./runstead-root.js";

export type TeamControlPlaneRunnerStatus = RuntimeRunnerRegistration["status"];

export type TeamControlPlanePostgresClient = PostgresControlPlaneClient & {
  end?: () => Promise<void>;
};

export type TeamControlPlanePostgresClientFactory = (
  stateUri: string
) => Promise<TeamControlPlanePostgresClient>;

export interface TeamControlPlaneRunnerOptions {
  cwd?: string;
  env?: RuntimeBackendConfigEnv;
  schema?: string;
  postgresClientFactory?: TeamControlPlanePostgresClientFactory;
}

export interface TeamControlPlaneRunnerHeartbeatOptions extends TeamControlPlaneRunnerOptions {
  runnerId?: string;
  organizationId?: string;
  workspaceId?: string;
  labels?: string[];
  status?: TeamControlPlaneRunnerStatus;
  migrate?: boolean;
  now?: Date;
}

export interface TeamControlPlaneRunnerHeartbeatResult {
  backend: "postgres";
  storageUri: string;
  schema: string;
  runner: RuntimeRunnerRegistration;
  migrated: boolean;
}

export interface TeamControlPlaneRunnerListOptions extends TeamControlPlaneRunnerOptions {
  organizationId?: string;
  workspaceId?: string;
  status?: TeamControlPlaneRunnerStatus;
}

export interface TeamControlPlaneRunnerListResult {
  backend: "postgres";
  storageUri: string;
  schema: string;
  runners: RuntimeRunnerRegistration[];
}

export async function recordTeamControlPlaneRunnerHeartbeat(
  options: TeamControlPlaneRunnerHeartbeatOptions = {}
): Promise<TeamControlPlaneRunnerHeartbeatResult> {
  await requireRunsteadRoot(options.cwd);

  const env = options.env ?? process.env;
  const connection = resolveTeamPostgresConnection(options);
  const runnerId = firstNonEmpty(
    options.runnerId,
    firstRunnerId(env.RUNSTEAD_RUNNER_ID)
  );

  if (runnerId === undefined) {
    throw new Error("runner heartbeat requires --runner-id or RUNSTEAD_RUNNER_ID");
  }

  const client = await connectTeamPostgresClient(connection);

  try {
    if (options.migrate === true) {
      await migratePostgresControlPlane(client, { schema: connection.schema });
    }

    const backend = createPostgresControlPlaneBackend({
      client,
      schema: connection.schema,
      stateUri: connection.stateUri
    });
    const organizationId = firstNonEmpty(
      options.organizationId,
      env.RUNSTEAD_TEAM_ORG_ID
    );
    const workspaceId = firstNonEmpty(
      options.workspaceId,
      env.RUNSTEAD_TEAM_WORKSPACE_ID
    );
    const runner = await backend.runners?.heartbeat({
      runnerId,
      ...(organizationId === undefined ? {} : { organizationId }),
      ...(workspaceId === undefined ? {} : { workspaceId }),
      labels:
        options.labels === undefined || options.labels.length === 0
          ? ["runstead", "team"]
          : options.labels,
      status: options.status ?? "active",
      now: options.now ?? new Date()
    });

    if (runner === undefined) {
      throw new Error("selected Postgres backend does not expose a runner registry");
    }

    return {
      backend: "postgres",
      storageUri: connection.stateUri,
      schema: connection.schema,
      runner,
      migrated: options.migrate === true
    };
  } finally {
    await client.end?.();
  }
}

export async function listTeamControlPlaneRunners(
  options: TeamControlPlaneRunnerListOptions = {}
): Promise<TeamControlPlaneRunnerListResult> {
  await requireRunsteadRoot(options.cwd);

  const env = options.env ?? process.env;
  const connection = resolveTeamPostgresConnection(options);
  const client = await connectTeamPostgresClient(connection);

  try {
    const backend = createPostgresControlPlaneBackend({
      client,
      schema: connection.schema,
      stateUri: connection.stateUri
    });
    const organizationId = firstNonEmpty(
      options.organizationId,
      env.RUNSTEAD_TEAM_ORG_ID
    );
    const workspaceId = firstNonEmpty(
      options.workspaceId,
      env.RUNSTEAD_TEAM_WORKSPACE_ID
    );
    const runners = await backend.runners?.list({
      ...(organizationId === undefined ? {} : { organizationId }),
      ...(workspaceId === undefined ? {} : { workspaceId }),
      ...(options.status === undefined ? {} : { status: options.status })
    });

    if (runners === undefined) {
      throw new Error("selected Postgres backend does not expose a runner registry");
    }

    return {
      backend: "postgres",
      storageUri: connection.stateUri,
      schema: connection.schema,
      runners
    };
  } finally {
    await client.end?.();
  }
}

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

function resolveTeamPostgresConnection(options: TeamControlPlaneRunnerOptions): {
  stateUri: string;
  schema: string;
  postgresClientFactory?: TeamControlPlanePostgresClientFactory;
} {
  const env = options.env ?? process.env;
  const stateUri = env.RUNSTEAD_POSTGRES_URL?.trim();

  if (env.RUNSTEAD_RUNTIME_BACKEND !== "postgres") {
    throw new Error(
      "RUNSTEAD_RUNTIME_BACKEND=postgres is required for live team runner operations"
    );
  }

  if (stateUri === undefined || stateUri.length === 0) {
    throw new Error(
      "RUNSTEAD_POSTGRES_URL is required for live team runner operations"
    );
  }

  return {
    stateUri,
    schema: options.schema ?? "runstead",
    ...(options.postgresClientFactory === undefined
      ? {}
      : { postgresClientFactory: options.postgresClientFactory })
  };
}

async function connectTeamPostgresClient(input: {
  stateUri: string;
  postgresClientFactory?: TeamControlPlanePostgresClientFactory;
}): Promise<TeamControlPlanePostgresClient> {
  if (input.postgresClientFactory !== undefined) {
    return input.postgresClientFactory(input.stateUri);
  }

  return PsqlPostgresControlPlaneClient.connect(input.stateUri);
}

function firstRunnerId(value: string | undefined): string | undefined {
  return value
    ?.split(",")
    .map((item) => item.trim())
    .find((item) => item.length > 0);
}

function firstNonEmpty(
  preferred: string | undefined,
  fallback: string | undefined
): string | undefined {
  if (preferred !== undefined && preferred.trim().length > 0) {
    return preferred.trim();
  }

  if (fallback !== undefined && fallback.trim().length > 0) {
    return fallback.trim();
  }

  return undefined;
}
