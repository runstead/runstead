import {
  createLocalRuntimeHomeLayout,
  createLocalSqliteStorageIdentity,
  type RuntimeStorageIdentity
} from "./control-plane.js";
import {
  assessTeamControlPlaneReadiness,
  type RuntimeTeamControlPlaneAssessment,
  type RuntimeTeamControlPlaneProfile,
  type RuntimeTeamAuthzPolicy
} from "./team-control-plane.js";

export type RuntimeBackendKind = "sqlite" | "postgres";

export interface RuntimeBackendConfigEnv {
  RUNSTEAD_RUNTIME_BACKEND?: string;
  RUNSTEAD_POSTGRES_URL?: string;
  RUNSTEAD_ARTIFACT_BASE_URI?: string;
  RUNSTEAD_TEAM_ORG_ID?: string;
  RUNSTEAD_TEAM_WORKSPACE_ID?: string;
  RUNSTEAD_RUNNER_ID?: string;
  RUNSTEAD_RUNNER_LAST_SEEN_AT?: string;
  RUNSTEAD_REQUIRE_RUNNER_HEARTBEAT?: string;
  RUNSTEAD_AUDIT_SINK_URI?: string;
  RUNSTEAD_TEAM_IDENTITY_PROVIDER?: string;
  RUNSTEAD_TEAM_TENANT_ISOLATION?: string;
  RUNSTEAD_TEAM_SECRETS_BOUNDARY?: string;
  RUNSTEAD_TEAM_RBAC?: string;
}

export interface RuntimeBackendSelectionInput {
  rootPath: string;
  env?: RuntimeBackendConfigEnv;
  now?: Date;
}

export interface RuntimeBackendSelection {
  backend: RuntimeBackendKind;
  storage: RuntimeStorageIdentity;
  setupBlockers: string[];
  warnings: string[];
  teamProfile?: RuntimeTeamControlPlaneProfile;
  teamAssessment?: RuntimeTeamControlPlaneAssessment;
}

export function resolveRuntimeBackendSelection(
  input: RuntimeBackendSelectionInput
): RuntimeBackendSelection {
  const env = input.env ?? {};
  const requestedBackend = normalizeBackendKind(env.RUNSTEAD_RUNTIME_BACKEND);

  if (requestedBackend === "sqlite") {
    const layout = createLocalRuntimeHomeLayout(input.rootPath);

    return {
      backend: "sqlite",
      storage: createLocalSqliteStorageIdentity(layout),
      setupBlockers: [],
      warnings: []
    };
  }

  return resolvePostgresBackendSelection(env, input.now ?? new Date());
}

function resolvePostgresBackendSelection(
  env: RuntimeBackendConfigEnv,
  now: Date
): RuntimeBackendSelection {
  const postgresUrl = env.RUNSTEAD_POSTGRES_URL;
  const artifactBaseUri = env.RUNSTEAD_ARTIFACT_BASE_URI;
  const organizationId = env.RUNSTEAD_TEAM_ORG_ID;
  const runnerIds = env.RUNSTEAD_RUNNER_ID;
  const auditSinkUri = env.RUNSTEAD_AUDIT_SINK_URI;
  const required = [
    ["RUNSTEAD_POSTGRES_URL", postgresUrl],
    ["RUNSTEAD_ARTIFACT_BASE_URI", artifactBaseUri],
    ["RUNSTEAD_TEAM_ORG_ID", organizationId],
    ["RUNSTEAD_RUNNER_ID", runnerIds],
    ["RUNSTEAD_AUDIT_SINK_URI", auditSinkUri]
  ] as const;
  const missing = required
    .filter(([, value]) => value === undefined || value.trim() === "")
    .map(([name]) => `${name} is required for RUNSTEAD_RUNTIME_BACKEND=postgres`);
  const storage: RuntimeStorageIdentity = {
    backend: "postgres",
    stateUri: postgresUrl ?? "postgres://unconfigured",
    ...(artifactBaseUri === undefined ? {} : { artifactBaseUri })
  };

  if (missing.length > 0) {
    return {
      backend: "postgres",
      storage,
      setupBlockers: missing,
      warnings: []
    };
  }

  const runnerLastSeenAt = parseRunnerLastSeenAt(
    splitRunnerIds(runnerIds ?? ""),
    env.RUNSTEAD_RUNNER_LAST_SEEN_AT
  );
  const profile: RuntimeTeamControlPlaneProfile = {
    scope: {
      kind: "team",
      organizationId: organizationId ?? "",
      ...(env.RUNSTEAD_TEAM_WORKSPACE_ID === undefined
        ? {}
        : { workspaceId: env.RUNSTEAD_TEAM_WORKSPACE_ID })
    },
    storage,
    runners: splitRunnerIds(runnerIds ?? "").map((runnerId) => {
      const lastSeenAt = runnerLastSeenAt.get(runnerId);

      return {
        runnerId,
        organizationId: organizationId ?? "",
        ...(env.RUNSTEAD_TEAM_WORKSPACE_ID === undefined
          ? {}
          : { workspaceId: env.RUNSTEAD_TEAM_WORKSPACE_ID }),
        labels: ["runstead", "team"],
        status: "active" as const,
        ...(lastSeenAt === undefined ? {} : { lastSeenAt })
      };
    }),
    leasePolicy: {
      backend: "database",
      fencingTokens: true,
      heartbeatTtlMs: 30_000
    },
    auditSinks: [
      {
        id: "team-audit",
        type: "object_store",
        uri: auditSinkUri ?? "",
        tamperEvidence: "hash_chain",
        retentionDays: 365
      }
    ],
    authz: resolveTeamAuthzPolicy(env)
  };
  const teamAssessment = assessTeamControlPlaneReadiness(profile, {
    now,
    requireRunnerHeartbeats:
      env.RUNSTEAD_REQUIRE_RUNNER_HEARTBEAT === undefined ||
      env.RUNSTEAD_REQUIRE_RUNNER_HEARTBEAT !== "false"
  });

  return {
    backend: "postgres",
    storage,
    setupBlockers: teamAssessment.blockers,
    warnings: teamAssessment.warnings,
    teamProfile: profile,
    teamAssessment
  };
}

function normalizeBackendKind(value: string | undefined): RuntimeBackendKind {
  if (value === undefined || value.trim() === "" || value === "sqlite") {
    return "sqlite";
  }

  if (value === "postgres") {
    return "postgres";
  }

  throw new Error(
    `RUNSTEAD_RUNTIME_BACKEND must be sqlite or postgres, received ${value}`
  );
}

function splitRunnerIds(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseRunnerLastSeenAt(
  runnerIds: string[],
  value: string | undefined
): Map<string, string> {
  const result = new Map<string, string>();

  if (value === undefined || value.trim() === "") {
    return result;
  }

  const entries = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (entries.length === 1 && !entries[0]?.includes("=")) {
    for (const runnerId of runnerIds) {
      result.set(runnerId, entries[0] ?? "");
    }

    return result;
  }

  for (const entry of entries) {
    const separator = entry.indexOf("=");

    if (separator <= 0) {
      continue;
    }

    const runnerId = entry.slice(0, separator).trim();
    const lastSeenAt = entry.slice(separator + 1).trim();

    if (runnerId.length > 0 && lastSeenAt.length > 0) {
      result.set(runnerId, lastSeenAt);
    }
  }

  return result;
}

function resolveTeamAuthzPolicy(env: RuntimeBackendConfigEnv): RuntimeTeamAuthzPolicy {
  return {
    identityProvider: parseIdentityProvider(env.RUNSTEAD_TEAM_IDENTITY_PROVIDER),
    rbac: env.RUNSTEAD_TEAM_RBAC === undefined || env.RUNSTEAD_TEAM_RBAC !== "false",
    tenantIsolation: parseTenantIsolation(env.RUNSTEAD_TEAM_TENANT_ISOLATION),
    secretsBoundary: parseSecretsBoundary(env.RUNSTEAD_TEAM_SECRETS_BOUNDARY)
  };
}

function parseIdentityProvider(
  value: string | undefined
): RuntimeTeamAuthzPolicy["identityProvider"] {
  if (value === "local" || value === "oidc" || value === "saml" || value === "custom") {
    return value;
  }

  return "oidc";
}

function parseTenantIsolation(
  value: string | undefined
): RuntimeTeamAuthzPolicy["tenantIsolation"] {
  if (value === "none" || value === "workspace" || value === "organization") {
    return value;
  }

  return "organization";
}

function parseSecretsBoundary(
  value: string | undefined
): RuntimeTeamAuthzPolicy["secretsBoundary"] {
  if (value === "local_env" || value === "central_secret_store" || value === "custom") {
    return value;
  }

  return "central_secret_store";
}
