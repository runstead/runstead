import type {
  RuntimeBackendConfigEnv,
  RuntimeRunnerRegistration
} from "@runstead/runtime";
import {
  createPostgresControlPlaneBackend,
  migratePostgresControlPlane
} from "@runstead/state-postgres";

import { requireRunsteadRoot } from "./runstead-root.js";
import {
  connectTeamPostgresClient,
  resolveTeamPostgresConnection,
  type TeamControlPlanePostgresClientFactory
} from "./team-control-plane-runner-connection.js";

export type TeamControlPlaneRunnerStatus = RuntimeRunnerRegistration["status"];

export type {
  TeamControlPlanePostgresClient,
  TeamControlPlanePostgresClientFactory
} from "./team-control-plane-runner-connection.js";

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

export interface TeamControlPlaneLiveCheckOptions extends TeamControlPlaneRunnerOptions {
  migrate?: boolean;
  requireInitialized?: boolean;
}

export interface TeamControlPlaneLiveCheckResult {
  backend: "postgres";
  storageUri: string;
  schema: string;
  migrated: boolean;
  runners: RuntimeRunnerRegistration[];
}

export async function checkTeamControlPlaneLiveBackend(
  options: TeamControlPlaneLiveCheckOptions = {}
): Promise<TeamControlPlaneLiveCheckResult> {
  if (options.requireInitialized !== false) {
    await requireRunsteadRoot(options.cwd);
  }

  const connection = resolveTeamPostgresConnection(options);
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
    const runners = await backend.runners?.list();

    if (runners === undefined) {
      throw new Error("selected Postgres backend does not expose a runner registry");
    }

    return {
      backend: "postgres",
      storageUri: connection.stateUri,
      schema: connection.schema,
      migrated: options.migrate === true,
      runners
    };
  } finally {
    await client.end?.();
  }
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

export {
  formatTeamControlPlaneRunnerHeartbeat,
  formatTeamControlPlaneRunnerList
} from "./team-control-plane-runner-format.js";

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
