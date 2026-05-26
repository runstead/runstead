import type { RuntimeBackendConfigEnv } from "@runstead/runtime";
import {
  PsqlPostgresControlPlaneClient,
  type PostgresControlPlaneClient
} from "@runstead/state-postgres";

export type TeamControlPlanePostgresClient = PostgresControlPlaneClient & {
  end?: () => Promise<void>;
};

export type TeamControlPlanePostgresClientFactory = (
  stateUri: string
) => Promise<TeamControlPlanePostgresClient>;

export interface TeamControlPlaneConnectionOptions {
  env?: RuntimeBackendConfigEnv;
  schema?: string;
  postgresClientFactory?: TeamControlPlanePostgresClientFactory;
}

export interface TeamControlPlanePostgresConnection {
  stateUri: string;
  schema: string;
  postgresClientFactory?: TeamControlPlanePostgresClientFactory;
}

export function resolveTeamPostgresConnection(
  options: TeamControlPlaneConnectionOptions
): TeamControlPlanePostgresConnection {
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

export async function connectTeamPostgresClient(input: {
  stateUri: string;
  postgresClientFactory?: TeamControlPlanePostgresClientFactory;
}): Promise<TeamControlPlanePostgresClient> {
  if (input.postgresClientFactory !== undefined) {
    return input.postgresClientFactory(input.stateUri);
  }

  return PsqlPostgresControlPlaneClient.connect(input.stateUri);
}
