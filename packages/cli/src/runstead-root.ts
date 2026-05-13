import { accessSync, constants } from "node:fs";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface ResolveRunsteadRootResult {
  cwd: string;
  root: string;
  source: "runstead" | "team" | "missing";
}

export interface ResolveRunsteadStateDbResult extends ResolveRunsteadRootResult {
  stateDb: string;
}

export async function resolveRunsteadRoot(
  cwd = process.cwd()
): Promise<ResolveRunsteadRootResult> {
  const workspace = resolve(cwd);
  const runsteadRoot = join(workspace, ".runstead");
  const teamRoot = join(workspace, ".team");

  if (await hasReadableConfig(runsteadRoot)) {
    return {
      cwd: workspace,
      root: runsteadRoot,
      source: "runstead"
    };
  }

  if (await hasReadableConfig(teamRoot)) {
    return {
      cwd: workspace,
      root: teamRoot,
      source: "team"
    };
  }

  return {
    cwd: workspace,
    root: runsteadRoot,
    source: "missing"
  };
}

export function resolveRunsteadRootSync(
  cwd = process.cwd()
): ResolveRunsteadRootResult {
  const workspace = resolve(cwd);
  const runsteadRoot = join(workspace, ".runstead");
  const teamRoot = join(workspace, ".team");

  if (hasReadableConfigSync(runsteadRoot)) {
    return {
      cwd: workspace,
      root: runsteadRoot,
      source: "runstead"
    };
  }

  if (hasReadableConfigSync(teamRoot)) {
    return {
      cwd: workspace,
      root: teamRoot,
      source: "team"
    };
  }

  return {
    cwd: workspace,
    root: runsteadRoot,
    source: "missing"
  };
}

export async function requireRunsteadRoot(
  cwd = process.cwd()
): Promise<ResolveRunsteadRootResult> {
  const resolved = await resolveRunsteadRoot(cwd);

  if (resolved.source === "missing") {
    throw new Error(`Runstead is not initialized at ${resolved.root}`);
  }

  return resolved;
}

export function requireRunsteadRootSync(
  cwd = process.cwd()
): ResolveRunsteadRootResult {
  const resolved = resolveRunsteadRootSync(cwd);

  if (resolved.source === "missing") {
    throw new Error(`Runstead is not initialized at ${resolved.root}`);
  }

  return resolved;
}

export async function requireRunsteadStateDb(
  cwd = process.cwd()
): Promise<ResolveRunsteadStateDbResult> {
  const resolved = await requireRunsteadRoot(cwd);
  const stateDb = join(resolved.root, "state.db");

  await assertReadableStateDb(stateDb);

  return {
    ...resolved,
    stateDb
  };
}

export function requireRunsteadStateDbSync(
  cwd = process.cwd()
): ResolveRunsteadStateDbResult {
  const resolved = requireRunsteadRootSync(cwd);
  const stateDb = join(resolved.root, "state.db");

  assertReadableStateDbSync(stateDb);

  return {
    ...resolved,
    stateDb
  };
}

async function hasReadableConfig(root: string): Promise<boolean> {
  try {
    await access(join(root, "config.yaml"), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertReadableStateDb(stateDb: string): Promise<void> {
  try {
    await access(stateDb, constants.R_OK);
  } catch {
    throw new Error(`Runstead state database is missing at ${stateDb}`);
  }
}

function assertReadableStateDbSync(stateDb: string): void {
  try {
    accessSync(stateDb, constants.R_OK);
  } catch {
    throw new Error(`Runstead state database is missing at ${stateDb}`);
  }
}

function hasReadableConfigSync(root: string): boolean {
  try {
    accessSync(join(root, "config.yaml"), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
