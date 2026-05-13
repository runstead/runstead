import { execFile } from "node:child_process";
import { access, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitInspection {
  isGitRepo: boolean;
  root?: string;
  branch?: string;
  headSha?: string;
}

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";
export type PackageManagerSource = "package_json" | "lockfile";

export interface PackageManagerInspection {
  detected: boolean;
  cwd: string;
  packageManager?: PackageManager;
  source?: PackageManagerSource;
  packageJsonPath?: string;
  lockfilePath?: string;
}

export async function inspectGitRepository(
  cwd = process.cwd()
): Promise<GitInspection> {
  const workspace = resolve(cwd);
  const root = await runGit(["rev-parse", "--show-toplevel"], workspace);

  if (!root.ok) {
    return {
      isGitRepo: false
    };
  }

  const branch = await runGit(["branch", "--show-current"], workspace);
  const headSha = await runGit(["rev-parse", "--verify", "HEAD"], workspace);
  const inspection: GitInspection = {
    isGitRepo: true,
    root: await realpath(root.stdout)
  };

  if (branch.ok && branch.stdout.length > 0) {
    inspection.branch = branch.stdout;
  }

  if (headSha.ok && headSha.stdout.length > 0) {
    inspection.headSha = headSha.stdout;
  }

  return inspection;
}

export async function inspectPackageManager(
  cwd = process.cwd()
): Promise<PackageManagerInspection> {
  const workspace = resolve(cwd);
  const packageJsonPath = join(workspace, "package.json");
  const packageManagerFromPackageJson =
    await readPackageManagerFromPackageJson(packageJsonPath);

  if (packageManagerFromPackageJson !== undefined) {
    return {
      detected: true,
      cwd: workspace,
      packageManager: packageManagerFromPackageJson,
      source: "package_json",
      packageJsonPath
    };
  }

  const lockfile = await detectLockfilePackageManager(workspace);

  if (lockfile !== undefined) {
    const result: PackageManagerInspection = {
      detected: true,
      cwd: workspace,
      packageManager: lockfile.packageManager,
      source: "lockfile",
      lockfilePath: lockfile.path
    };

    if (await exists(packageJsonPath)) {
      result.packageJsonPath = packageJsonPath;
    }

    return result;
  }

  const result: PackageManagerInspection = {
    detected: false,
    cwd: workspace
  };

  if (await exists(packageJsonPath)) {
    result.packageJsonPath = packageJsonPath;
  }

  return result;
}

interface GitCommandResult {
  ok: boolean;
  stdout: string;
}

async function runGit(args: string[], cwd: string): Promise<GitCommandResult> {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      windowsHide: true
    });

    return {
      ok: true,
      stdout: result.stdout.trim()
    };
  } catch {
    return {
      ok: false,
      stdout: ""
    };
  }
}

async function readPackageManagerFromPackageJson(
  packageJsonPath: string
): Promise<PackageManager | undefined> {
  try {
    const raw = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { packageManager?: unknown };

    if (typeof parsed.packageManager !== "string") {
      return undefined;
    }

    return parsePackageManagerName(parsed.packageManager);
  } catch {
    return undefined;
  }
}

function parsePackageManagerName(value: string): PackageManager | undefined {
  if (value.startsWith("pnpm@")) return "pnpm";
  if (value.startsWith("npm@")) return "npm";
  if (value.startsWith("yarn@")) return "yarn";
  if (value.startsWith("bun@")) return "bun";
  return undefined;
}

async function detectLockfilePackageManager(
  cwd: string
): Promise<{ packageManager: PackageManager; path: string } | undefined> {
  const lockfiles: { packageManager: PackageManager; filename: string }[] = [
    { packageManager: "pnpm", filename: "pnpm-lock.yaml" },
    { packageManager: "npm", filename: "package-lock.json" },
    { packageManager: "npm", filename: "npm-shrinkwrap.json" },
    { packageManager: "yarn", filename: "yarn.lock" },
    { packageManager: "bun", filename: "bun.lock" },
    { packageManager: "bun", filename: "bun.lockb" }
  ];

  for (const lockfile of lockfiles) {
    const path = join(cwd, lockfile.filename);

    if (await exists(path)) {
      return {
        packageManager: lockfile.packageManager,
        path
      };
    }
  }

  return undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
