import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface ResolveRunsteadRootResult {
  cwd: string;
  root: string;
  source: "runstead" | "team" | "missing";
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

async function hasReadableConfig(root: string): Promise<boolean> {
  try {
    await access(join(root, "config.yaml"), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
