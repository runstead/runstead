import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { requireRunsteadRoot } from "./runstead-root.js";

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
