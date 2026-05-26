import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  resolveRuntimeBackendSelection,
  type RuntimeBackendConfigEnv,
  type RuntimeBackendSelection
} from "@runstead/runtime";
import { formatPostgresControlPlaneMigrationSql } from "@runstead/state-postgres";

import { requireRunsteadRoot, resolveRunsteadRoot } from "./runstead-root.js";
import {
  teamControlPlaneAssertions,
  teamControlPlaneNextActions
} from "./team-control-plane-assessment.js";
import {
  envWithLiveRunnerHeartbeats,
  inspectLiveTeamControlPlaneBackend,
  liveTeamControlPlaneAssertions,
  liveTeamControlPlaneCheckSnapshot,
  type TeamControlPlaneCheckLiveBackend
} from "./team-control-plane-live.js";
import type { TeamControlPlanePostgresClientFactory } from "./team-control-plane-runner.js";

export {
  checkTeamControlPlaneLiveBackend,
  formatTeamControlPlaneRunnerHeartbeat,
  formatTeamControlPlaneRunnerList,
  listTeamControlPlaneRunners,
  recordTeamControlPlaneRunnerHeartbeat
} from "./team-control-plane-runner.js";
export type {
  TeamControlPlaneLiveCheckOptions,
  TeamControlPlaneLiveCheckResult,
  TeamControlPlanePostgresClient,
  TeamControlPlanePostgresClientFactory,
  TeamControlPlaneRunnerHeartbeatOptions,
  TeamControlPlaneRunnerHeartbeatResult,
  TeamControlPlaneRunnerListOptions,
  TeamControlPlaneRunnerListResult,
  TeamControlPlaneRunnerOptions,
  TeamControlPlaneRunnerStatus
} from "./team-control-plane-runner.js";
export type { TeamControlPlaneCheckLiveBackend } from "./team-control-plane-live.js";

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
  live?: boolean;
  liveMigrate?: boolean;
  liveRequireInitialized?: boolean;
  schema?: string;
  postgresClientFactory?: TeamControlPlanePostgresClientFactory;
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
  liveBackend?: TeamControlPlaneCheckLiveBackend;
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
  const liveBackend =
    options.live === true
      ? await inspectLiveTeamControlPlaneBackend({
          cwd,
          env,
          migrate: options.liveMigrate === true,
          requireInitialized: options.liveRequireInitialized !== false,
          ...(options.schema === undefined ? {} : { schema: options.schema }),
          ...(options.postgresClientFactory === undefined
            ? {}
            : { postgresClientFactory: options.postgresClientFactory })
        })
      : undefined;
  const effectiveEnv =
    liveBackend?.connected === true && liveBackend.runners.length > 0
      ? envWithLiveRunnerHeartbeats(env, liveBackend.runners)
      : env;
  let selection: RuntimeBackendSelection | undefined;
  let selectionError: string | undefined;

  try {
    selection = resolveRuntimeBackendSelection({
      rootPath: root.root,
      env: effectiveEnv,
      ...(options.now === undefined ? {} : { now: options.now })
    });
  } catch (error) {
    selectionError = errorMessage(error);
  }

  const assertions = teamControlPlaneAssertions({
    env: effectiveEnv,
    rootSource: root.source,
    ...(selection === undefined ? {} : { selection }),
    ...(selectionError === undefined ? {} : { selectionError })
  });
  if (liveBackend !== undefined) {
    assertions.push(...liveTeamControlPlaneAssertions(liveBackend));
  }
  const setupBlockers = [
    ...(selection?.setupBlockers ?? []),
    ...(selectionError === undefined ? [] : [selectionError]),
    ...(liveBackend?.blockers ?? [])
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
    nextActions,
    ...(liveBackend === undefined
      ? {}
      : {
          liveBackend: liveTeamControlPlaneCheckSnapshot(
            liveBackend,
            options.now ?? new Date()
          )
        })
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
