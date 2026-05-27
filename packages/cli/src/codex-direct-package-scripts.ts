import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import {
  detectCodexDirectPackageManager,
  fileExists,
  isNodeErrorCode,
  isRecord,
  packageVerifierCandidates,
  readCodexDirectPackageJson,
  type CodexDirectPackageManager,
  type PackageVerifierCandidate
} from "./codex-direct-package-manager.js";

export type { CodexDirectPackageManager, PackageVerifierCandidate };

export interface PackageScriptSummary {
  name: string;
  command: string;
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
  const packageJson = await readCodexDirectPackageJson(packageJsonPath);
  const packageManager = await detectCodexDirectPackageManager(
    target.absolutePath,
    packageJson
  );
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
    verifierCandidates: packageVerifierCandidates({
      packageManager: packageManager.packageManager,
      scripts: packageJson?.scripts ?? {},
      turboTasks
    }),
    workspace: {
      pnpmWorkspace: await fileExists(join(target.absolutePath, "pnpm-workspace.yaml")),
      packagePatterns: await readPnpmWorkspacePatterns(target.absolutePath),
      turboTasks: [...turboTasks].sort()
    }
  };
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
