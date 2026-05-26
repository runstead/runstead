import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  resolveRuntimeBackendSelection,
  type RuntimeBackendConfigEnv,
  type RuntimeBackendSelection
} from "@runstead/runtime";
import { formatPostgresControlPlaneMigrationSql } from "@runstead/state-postgres";

import { requireRunsteadRoot, resolveRunsteadRoot } from "./runstead-root.js";

export type TeamControlPlaneAssertionStatus = "pass" | "fail" | "warn";

export interface TeamControlPlaneAssertion {
  id: string;
  title: string;
  status: TeamControlPlaneAssertionStatus;
  message: string;
  evidence: string[];
}

export interface TeamControlPlaneCheckOptions {
  cwd?: string;
  env?: RuntimeBackendConfigEnv;
  now?: Date;
}

export interface TeamControlPlaneCheckResult {
  cwd: string;
  root: string;
  initialized: boolean;
  backend: string;
  storageUri: string;
  artifactBaseUri?: string;
  passed: boolean;
  assertions: TeamControlPlaneAssertion[];
  setupBlockers: string[];
  warnings: string[];
  nextActions: string[];
}

export interface BootstrapTeamControlPlaneOptions {
  cwd?: string;
  output?: string;
  force?: boolean;
}

export interface BootstrapTeamControlPlaneResult {
  path: string;
  overwritten: boolean;
  checkCommand: string;
}

export interface TeamControlPlaneMigrationSqlOptions {
  schema?: string;
}

const TEAM_CONTROL_PLANE_ENV_TEMPLATE = `# Runstead team control-plane backend.
# Fill these values in CI or the runner environment. Do not commit real secrets.

RUNSTEAD_RUNTIME_BACKEND=postgres
RUNSTEAD_POSTGRES_URL=postgres://runstead/state
RUNSTEAD_ARTIFACT_BASE_URI=s3://runstead/evidence
RUNSTEAD_TEAM_ORG_ID=org_123
RUNSTEAD_TEAM_WORKSPACE_ID=workspace_123
RUNSTEAD_RUNNER_ID=runner_1
RUNSTEAD_RUNNER_LAST_SEEN_AT=runner_1=2026-05-24T00:00:00.000Z
RUNSTEAD_REQUIRE_RUNNER_HEARTBEAT=true
RUNSTEAD_AUDIT_SINK_URI=s3://runstead/audit
RUNSTEAD_TEAM_IDENTITY_PROVIDER=oidc
RUNSTEAD_TEAM_TENANT_ISOLATION=organization
RUNSTEAD_TEAM_SECRETS_BOUNDARY=central_secret_store
RUNSTEAD_TEAM_RBAC=true
`;

export async function checkTeamControlPlane(
  options: TeamControlPlaneCheckOptions = {}
): Promise<TeamControlPlaneCheckResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const root = await resolveRunsteadRoot(cwd);
  const env = options.env ?? process.env;
  let selection: RuntimeBackendSelection | undefined;
  let selectionError: string | undefined;

  try {
    selection = resolveRuntimeBackendSelection({
      rootPath: root.root,
      env,
      ...(options.now === undefined ? {} : { now: options.now })
    });
  } catch (error) {
    selectionError = errorMessage(error);
  }

  const assertions = teamControlPlaneAssertions({
    env,
    rootSource: root.source,
    ...(selection === undefined ? {} : { selection }),
    ...(selectionError === undefined ? {} : { selectionError })
  });
  const setupBlockers = [
    ...(selection?.setupBlockers ?? []),
    ...(selectionError === undefined ? [] : [selectionError])
  ];
  const warnings = selection?.warnings ?? [];
  const nextActions = teamControlPlaneNextActions(assertions, setupBlockers);
  const passed =
    assertions.every((assertion) => assertion.status !== "fail") &&
    setupBlockers.length === 0;

  return {
    cwd: root.cwd,
    root: root.root,
    initialized: root.source !== "missing",
    backend: selection?.backend ?? "invalid",
    storageUri: selection?.storage.stateUri ?? "unresolved",
    ...(selection?.storage.artifactBaseUri === undefined
      ? {}
      : { artifactBaseUri: selection.storage.artifactBaseUri }),
    passed,
    assertions,
    setupBlockers,
    warnings,
    nextActions
  };
}

export async function bootstrapTeamControlPlane(
  options: BootstrapTeamControlPlaneOptions = {}
): Promise<BootstrapTeamControlPlaneResult> {
  const root = await requireRunsteadRoot(options.cwd);
  const path =
    options.output === undefined
      ? join(root.root, "team-control-plane.env.example")
      : resolve(root.cwd, options.output);
  const exists = await pathExists(path);

  if (exists && options.force !== true) {
    return {
      path,
      overwritten: false,
      checkCommand: `runstead team control-plane check --cwd ${shellQuote(root.cwd)}`
    };
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, TEAM_CONTROL_PLANE_ENV_TEMPLATE, "utf8");

  return {
    path,
    overwritten: exists,
    checkCommand: `runstead team control-plane check --cwd ${shellQuote(root.cwd)}`
  };
}

export function teamControlPlaneMigrationSql(
  options: TeamControlPlaneMigrationSqlOptions = {}
): string {
  return formatPostgresControlPlaneMigrationSql({
    ...(options.schema === undefined ? {} : { schema: options.schema })
  });
}

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

function teamControlPlaneAssertions(input: {
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

function teamControlPlaneNextActions(
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

function nonEmpty(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
