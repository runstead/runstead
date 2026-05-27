import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const STANDARD_VERIFIER_SCRIPT_NAMES = ["test", "lint", "typecheck"] as const;

export type CodexDirectPackageManager = "pnpm" | "npm" | "yarn" | "bun";
export type CodexDirectPackageManagerSource = "package_json" | "lockfile" | "default";

export interface CodexDirectPackageJson {
  packageManager?: string;
  scripts: Record<string, string>;
}

export interface PackageVerifierCandidate {
  name: string;
  command: string;
  source: "package_script" | "turbo_task";
}

export async function readCodexDirectPackageJson(
  path: string
): Promise<CodexDirectPackageJson | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;

    if (!isRecord(parsed)) {
      return undefined;
    }

    return {
      ...(typeof parsed.packageManager === "string"
        ? { packageManager: parsed.packageManager }
        : {}),
      scripts: readPackageScripts(parsed.scripts)
    };
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

export async function detectCodexDirectPackageManager(
  cwd: string,
  packageJson: { packageManager?: string } | undefined
): Promise<{
  packageManager: CodexDirectPackageManager;
  source: CodexDirectPackageManagerSource;
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

export function packageVerifierCandidates(input: {
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

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function isNodeErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPackageScripts(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([name, command]) =>
      typeof command === "string" ? [[name, command]] : []
    )
  );
}

async function detectPackageManagerFromLockfile(
  cwd: string
): Promise<CodexDirectPackageManager | undefined> {
  if (await fileExists(join(cwd, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if ((await fileExists(join(cwd, "yarn.lock"))) === true) {
    return "yarn";
  }

  if (
    (await fileExists(join(cwd, "bun.lock"))) ||
    (await fileExists(join(cwd, "bun.lockb")))
  ) {
    return "bun";
  }

  if (
    (await fileExists(join(cwd, "package-lock.json"))) ||
    (await fileExists(join(cwd, "npm-shrinkwrap.json")))
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
