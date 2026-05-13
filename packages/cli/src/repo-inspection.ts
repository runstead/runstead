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

export interface PackageScriptCommandInspection {
  detected: boolean;
  scriptName: string;
  cwd: string;
  command?: string;
  rawScript?: string;
  packageJsonPath?: string;
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

export async function inspectTestCommand(
  cwd = process.cwd()
): Promise<PackageScriptCommandInspection> {
  return inspectPackageScriptCommand(cwd, "test");
}

export async function inspectLintCommand(
  cwd = process.cwd()
): Promise<PackageScriptCommandInspection> {
  return inspectPackageScriptCommand(cwd, "lint");
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

async function inspectPackageScriptCommand(
  cwd: string,
  scriptName: string
): Promise<PackageScriptCommandInspection> {
  const workspace = resolve(cwd);
  const packageJsonPath = join(workspace, "package.json");
  const rawScript = await readPackageScript(packageJsonPath, scriptName);

  if (rawScript === undefined || isPlaceholderTestScript(scriptName, rawScript)) {
    const result: PackageScriptCommandInspection = {
      detected: false,
      scriptName,
      cwd: workspace
    };

    if (await exists(packageJsonPath)) {
      result.packageJsonPath = packageJsonPath;
    }

    return result;
  }

  const packageManager = await inspectPackageManager(workspace);

  return {
    detected: true,
    scriptName,
    cwd: workspace,
    command: formatPackageScriptCommand(
      packageManager.packageManager ?? "npm",
      scriptName
    ),
    rawScript,
    packageJsonPath
  };
}

async function readPackageScript(
  packageJsonPath: string,
  scriptName: string
): Promise<string | undefined> {
  try {
    const raw = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    const script = parsed.scripts?.[scriptName];

    return typeof script === "string" ? script : undefined;
  } catch {
    return undefined;
  }
}

function isPlaceholderTestScript(scriptName: string, rawScript: string): boolean {
  return (
    scriptName === "test" &&
    rawScript.includes("Error: no test specified") &&
    rawScript.includes("exit 1")
  );
}

function formatPackageScriptCommand(
  packageManager: PackageManager,
  scriptName: string
): string {
  if (scriptName === "test") {
    switch (packageManager) {
      case "pnpm":
        return "pnpm test";
      case "npm":
        return "npm test";
      case "yarn":
        return "yarn test";
      case "bun":
        return "bun test";
    }
  }

  switch (packageManager) {
    case "pnpm":
      return `pnpm run ${scriptName}`;
    case "npm":
      return `npm run ${scriptName}`;
    case "yarn":
      return `yarn ${scriptName}`;
    case "bun":
      return `bun run ${scriptName}`;
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
