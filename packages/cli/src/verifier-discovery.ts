import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { CommandVerifierInput } from "./verifier-evidence.js";

export interface DiscoverVerifierCommandsOptions {
  cwd?: string;
}

type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

const STANDARD_VERIFIERS = ["test", "lint", "typecheck"] as const;

export async function discoverVerifierCommands(
  options: DiscoverVerifierCommandsOptions = {}
): Promise<CommandVerifierInput[]> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const packageJson = await readPackageJson(cwd);
  const scripts = packageJson?.scripts ?? {};
  const turboTasks = await readTurboTasks(cwd);
  const packageManager = await detectPackageManager(cwd, packageJson);

  return STANDARD_VERIFIERS.flatMap((name): CommandVerifierInput[] => {
    if (scripts[name] === undefined && !turboTasks.has(name)) {
      return [];
    }

    return [
      {
        name,
        command: packageManagerCommand(packageManager, name)
      }
    ];
  });
}

async function detectPackageManager(
  cwd: string,
  packageJson: PackageJson | undefined
): Promise<PackageManager> {
  const declared = packageJson?.packageManager?.split("@")[0];

  if (isPackageManager(declared)) {
    return declared;
  }

  if (
    (await exists(join(cwd, "pnpm-workspace.yaml"))) ||
    (await exists(join(cwd, "pnpm-lock.yaml")))
  ) {
    return "pnpm";
  }

  if ((await exists(join(cwd, "yarn.lock")))) {
    return "yarn";
  }

  if ((await exists(join(cwd, "bun.lockb"))) || (await exists(join(cwd, "bun.lock")))) {
    return "bun";
  }

  return "npm";
}

function packageManagerCommand(
  packageManager: PackageManager,
  script: (typeof STANDARD_VERIFIERS)[number]
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

async function readPackageJson(cwd: string): Promise<PackageJson | undefined> {
  try {
    const raw = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as unknown;

    if (!isRecord(raw)) {
      return undefined;
    }

    return {
      ...(typeof raw.packageManager === "string"
        ? { packageManager: raw.packageManager }
        : {}),
      scripts: readScripts(raw.scripts)
    };
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

async function readTurboTasks(cwd: string): Promise<Set<string>> {
  try {
    const raw = JSON.parse(await readFile(join(cwd, "turbo.json"), "utf8")) as unknown;

    if (!isRecord(raw)) {
      return new Set();
    }

    const tasks = isRecord(raw.tasks)
      ? Object.keys(raw.tasks)
      : isRecord(raw.pipeline)
        ? Object.keys(raw.pipeline)
        : [];

    return new Set(tasks);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return new Set();
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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isPackageManager(value: string | undefined): value is PackageManager {
  return value === "pnpm" || value === "npm" || value === "yarn" || value === "bun";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

interface PackageJson {
  packageManager?: string;
  scripts: Record<string, string>;
}
