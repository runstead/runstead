import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

const STANDARD_VERIFIER_SCRIPT_NAMES = ["test", "lint", "typecheck"] as const;

export type CodexDirectPackageManager = "pnpm" | "npm" | "yarn" | "bun";

export interface PackageScriptSummary {
  name: string;
  command: string;
}

export interface PackageVerifierCandidate {
  name: string;
  command: string;
  source: "package_script" | "turbo_task";
}

export interface PackageScriptsInspectionTarget {
  root: string;
  absolutePath: string;
  relativePath: string;
}

export interface PackageScriptsInspectionResult {
  cwd: string;
  path: string;
  packageJsonPath?: string;
  packageManager: CodexDirectPackageManager;
  packageManagerSource: "package_json" | "lockfile" | "default";
  scripts: PackageScriptSummary[];
  verifierCandidates: PackageVerifierCandidate[];
  workspace: {
    pnpmWorkspace: boolean;
    packagePatterns: string[];
    turboTasks: string[];
  };
}

export async function inspectPackageScriptsTarget(
  target: PackageScriptsInspectionTarget
): Promise<PackageScriptsInspectionResult> {
  const packageJsonPath = join(target.absolutePath, "package.json");
  const packageJson = await readPackageJson(packageJsonPath);
  const packageManager = await detectPackageManager(target.absolutePath, packageJson);
  const turboTasks = await readTurboTasks(target.absolutePath);
  const scripts = Object.entries(packageJson?.scripts ?? {})
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([name, command]) => ({ name, command }));

  return {
    cwd: target.root,
    path: target.relativePath,
    ...(packageJson === undefined ? {} : { packageJsonPath }),
    packageManager: packageManager.packageManager,
    packageManagerSource: packageManager.source,
    scripts,
    verifierCandidates: verifierCandidates({
      packageManager: packageManager.packageManager,
      scripts: packageJson?.scripts ?? {},
      turboTasks
    }),
    workspace: {
      pnpmWorkspace: await exists(join(target.absolutePath, "pnpm-workspace.yaml")),
      packagePatterns: await readPnpmWorkspacePatterns(target.absolutePath),
      turboTasks: [...turboTasks].sort()
    }
  };
}

async function readPackageJson(path: string): Promise<
  | {
      packageManager?: string;
      scripts: Record<string, string>;
    }
  | undefined
> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;

    if (!isRecord(parsed)) {
      return undefined;
    }

    return {
      ...(typeof parsed.packageManager === "string"
        ? { packageManager: parsed.packageManager }
        : {}),
      scripts: readScripts(parsed.scripts)
    };
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

function readScripts(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([name, command]) =>
      typeof command === "string" ? [[name, command]] : []
    )
  );
}

async function detectPackageManager(
  cwd: string,
  packageJson: { packageManager?: string } | undefined
): Promise<{
  packageManager: CodexDirectPackageManager;
  source: PackageScriptsInspectionResult["packageManagerSource"];
}> {
  const declared = parsePackageManagerName(packageJson?.packageManager);

  if (declared !== undefined) {
    return {
      packageManager: declared,
      source: "package_json"
    };
  }

  const lockfile = await detectPackageManagerFromLockfile(cwd);

  if (lockfile !== undefined) {
    return {
      packageManager: lockfile,
      source: "lockfile"
    };
  }

  return {
    packageManager: "npm",
    source: "default"
  };
}

async function detectPackageManagerFromLockfile(
  cwd: string
): Promise<CodexDirectPackageManager | undefined> {
  if (await exists(join(cwd, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if ((await exists(join(cwd, "yarn.lock"))) === true) {
    return "yarn";
  }

  if ((await exists(join(cwd, "bun.lock"))) || (await exists(join(cwd, "bun.lockb")))) {
    return "bun";
  }

  if (
    (await exists(join(cwd, "package-lock.json"))) ||
    (await exists(join(cwd, "npm-shrinkwrap.json")))
  ) {
    return "npm";
  }

  return undefined;
}

function parsePackageManagerName(
  value: string | undefined
): CodexDirectPackageManager | undefined {
  const name = value?.split("@")[0];

  return isPackageManager(name) ? name : undefined;
}

function isPackageManager(
  value: string | undefined
): value is CodexDirectPackageManager {
  return value === "pnpm" || value === "npm" || value === "yarn" || value === "bun";
}

async function readPnpmWorkspacePatterns(cwd: string): Promise<string[]> {
  try {
    const parsed = parseYaml(
      await readFile(join(cwd, "pnpm-workspace.yaml"), "utf8")
    ) as unknown;

    if (!isRecord(parsed) || !Array.isArray(parsed.packages)) {
      return [];
    }

    return parsed.packages.filter(
      (pattern): pattern is string => typeof pattern === "string"
    );
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }
}

async function readTurboTasks(cwd: string): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(
      await readFile(join(cwd, "turbo.json"), "utf8")
    ) as unknown;

    if (!isRecord(parsed)) {
      return new Set();
    }

    const tasks = isRecord(parsed.tasks)
      ? Object.keys(parsed.tasks)
      : isRecord(parsed.pipeline)
        ? Object.keys(parsed.pipeline)
        : [];

    return new Set(tasks);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return new Set();
    }

    throw error;
  }
}

function verifierCandidates(input: {
  packageManager: CodexDirectPackageManager;
  scripts: Record<string, string>;
  turboTasks: Set<string>;
}): PackageVerifierCandidate[] {
  return STANDARD_VERIFIER_SCRIPT_NAMES.flatMap((name): PackageVerifierCandidate[] => {
    if (input.scripts[name] !== undefined) {
      return [
        {
          name,
          command: packageManagerScriptCommand(input.packageManager, name),
          source: "package_script"
        }
      ];
    }

    if (input.turboTasks.has(name)) {
      return [
        {
          name,
          command: turboScriptCommand(input.packageManager, name),
          source: "turbo_task"
        }
      ];
    }

    return [];
  });
}

function packageManagerScriptCommand(
  packageManager: CodexDirectPackageManager,
  script: (typeof STANDARD_VERIFIER_SCRIPT_NAMES)[number]
): string {
  switch (packageManager) {
    case "pnpm":
      return `pnpm ${script}`;
    case "npm":
      return script === "test" ? "npm test" : `npm run ${script}`;
    case "yarn":
      return `yarn ${script}`;
    case "bun":
      return `bun run ${script}`;
  }
}

function turboScriptCommand(
  packageManager: CodexDirectPackageManager,
  script: (typeof STANDARD_VERIFIER_SCRIPT_NAMES)[number]
): string {
  switch (packageManager) {
    case "pnpm":
      return `pnpm exec turbo run ${script}`;
    case "npm":
      return `npm exec -- turbo run ${script}`;
    case "yarn":
      return `yarn turbo run ${script}`;
    case "bun":
      return `bunx turbo run ${script}`;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
