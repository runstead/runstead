import type {
  RuntimeBackendConfigEnv,
  RuntimeBackendSelection
} from "@runstead/runtime";

import type { TeamControlPlaneAssertion } from "./team-control-plane.js";

export function teamControlPlaneAssertions(input: {
  env: RuntimeBackendConfigEnv;
  rootSource: "runstead" | "team" | "missing";
  selection?: RuntimeBackendSelection;
  selectionError?: string;
}): TeamControlPlaneAssertion[] {
  const capabilities = input.selection?.teamAssessment?.capabilities;
  const authz = input.selection?.teamProfile?.authz;
  const auditSink = input.selection?.teamProfile?.auditSinks[0];

  return [
    assertion({
      id: "workspace-initialized",
      title: "Workspace initialized",
      ok: input.rootSource !== "missing",
      pass: `Runstead root source is ${input.rootSource}`,
      fail: "Runstead must be initialized before a team control plane can be bootstrapped"
    }),
    assertion({
      id: "backend-selected",
      title: "Postgres backend selected",
      ok: input.selection?.backend === "postgres",
      pass: "RUNSTEAD_RUNTIME_BACKEND selects postgres",
      fail: "RUNSTEAD_RUNTIME_BACKEND=postgres is required for team mode"
    }),
    assertion({
      id: "postgres-connection",
      title: "Postgres connection",
      ok: nonEmpty(input.env.RUNSTEAD_POSTGRES_URL),
      pass: "RUNSTEAD_POSTGRES_URL is configured",
      fail: "RUNSTEAD_POSTGRES_URL is required"
    }),
    assertion({
      id: "artifact-base-uri",
      title: "Shared artifact base URI",
      ok: nonEmpty(input.env.RUNSTEAD_ARTIFACT_BASE_URI),
      pass: "RUNSTEAD_ARTIFACT_BASE_URI is configured",
      fail: "RUNSTEAD_ARTIFACT_BASE_URI is required for shared artifacts"
    }),
    assertion({
      id: "runner-identity",
      title: "Runner identity",
      ok: (capabilities?.registeredRunners ?? 0) > 0,
      pass: `${capabilities?.registeredRunners ?? 0} active runner(s) configured`,
      fail: "RUNSTEAD_RUNNER_ID must include at least one active runner id"
    }),
    assertion({
      id: "runner-heartbeat",
      title: "Runner heartbeat",
      ok: (capabilities?.freshRunnerHeartbeats ?? 0) > 0,
      pass: `${capabilities?.freshRunnerHeartbeats ?? 0} fresh runner heartbeat(s) recorded`,
      fail: "RUNSTEAD_RUNNER_LAST_SEEN_AT must include at least one fresh active runner heartbeat"
    }),
    assertion({
      id: "lock-lease-fencing",
      title: "Distributed lock lease fencing",
      ok: capabilities?.distributedLeases === true,
      pass: "database leases with fencing tokens are configured",
      fail: "team runners require database or distributed leases with fencing tokens"
    }),
    assertion({
      id: "audit-hash-chain",
      title: "Append-only audit sink",
      ok: capabilities?.appendOnlyAudit === true,
      pass:
        auditSink === undefined
          ? "append-only audit sink is configured"
          : `${auditSink.uri} uses ${auditSink.tamperEvidence}`,
      fail: "RUNSTEAD_AUDIT_SINK_URI with hash-chain or append-only audit is required"
    }),
    assertion({
      id: "oidc-rbac",
      title: "OIDC/RBAC boundary",
      ok: capabilities?.organizationAuthz === true,
      pass:
        authz === undefined
          ? "organization authz is configured"
          : `${authz.identityProvider} identity with RBAC and ${authz.tenantIsolation} isolation`,
      fail: "team mode requires non-local identity, RBAC, tenant isolation, and central secrets"
    }),
    assertion({
      id: "secret-store",
      title: "Secret-store boundary",
      ok:
        input.env.RUNSTEAD_TEAM_SECRETS_BOUNDARY === undefined ||
        input.env.RUNSTEAD_TEAM_SECRETS_BOUNDARY === "central_secret_store" ||
        input.env.RUNSTEAD_TEAM_SECRETS_BOUNDARY === "custom",
      pass: `secret boundary is ${input.env.RUNSTEAD_TEAM_SECRETS_BOUNDARY ?? "central_secret_store"}`,
      fail: "RUNSTEAD_TEAM_SECRETS_BOUNDARY must not be local_env for team mode"
    }),
    ...(input.selectionError === undefined
      ? []
      : [
          {
            id: "backend-config",
            title: "Backend configuration",
            status: "fail" as const,
            message: input.selectionError,
            evidence: []
          }
        ])
  ];
}

export function teamControlPlaneNextActions(
  assertions: TeamControlPlaneAssertion[],
  setupBlockers: string[]
): string[] {
  const failed = new Set(
    assertions.filter((assertion) => assertion.status === "fail").map((item) => item.id)
  );
  const actions = [
    failed.has("workspace-initialized") ? "run runstead init --cwd <repo>" : undefined,
    failed.has("backend-selected")
      ? "export RUNSTEAD_RUNTIME_BACKEND=postgres"
      : undefined,
    failed.has("postgres-connection")
      ? "export RUNSTEAD_POSTGRES_URL for the shared Postgres state database"
      : undefined,
    failed.has("artifact-base-uri")
      ? "export RUNSTEAD_ARTIFACT_BASE_URI for shared evidence artifacts"
      : undefined,
    failed.has("runner-identity")
      ? "export RUNSTEAD_TEAM_ORG_ID and RUNSTEAD_RUNNER_ID"
      : undefined,
    failed.has("runner-heartbeat")
      ? "export RUNSTEAD_RUNNER_LAST_SEEN_AT with fresh runner heartbeat timestamps"
      : undefined,
    failed.has("audit-hash-chain")
      ? "export RUNSTEAD_AUDIT_SINK_URI for hash-chain audit export"
      : undefined,
    failed.has("oidc-rbac")
      ? "configure RUNSTEAD_TEAM_IDENTITY_PROVIDER, RUNSTEAD_TEAM_RBAC, tenant isolation, and secret boundary"
      : undefined,
    failed.has("secret-store")
      ? "set RUNSTEAD_TEAM_SECRETS_BOUNDARY=central_secret_store or custom"
      : undefined,
    ...setupBlockers.map((blocker) => `resolve backend setup blocker: ${blocker}`)
  ].filter((action): action is string => action !== undefined);

  return [...new Set(actions)];
}

function assertion(input: {
  id: string;
  title: string;
  ok: boolean;
  pass: string;
  fail: string;
}): TeamControlPlaneAssertion {
  return {
    id: input.id,
    title: input.title,
    status: input.ok ? "pass" : "fail",
    message: input.ok ? input.pass : input.fail,
    evidence: input.ok ? [input.pass] : []
  };
}

function nonEmpty(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}
