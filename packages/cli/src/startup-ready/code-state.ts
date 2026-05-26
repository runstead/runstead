import {
  collectCommandVerifierCodeState,
  type CommandVerifierCodeState
} from "../verifier-evidence.js";
import type {
  StartupReadinessDirtyBreakdown,
  StartupReadinessDirtyState
} from "./types.js";

export async function collectStartupReadyCodeState(cwd: string): Promise<{
  gitHead?: string;
  dirtyState: StartupReadinessDirtyState;
  dirtyBreakdown: StartupReadinessDirtyBreakdown;
  fingerprint: string;
}> {
  const codeState = await collectCommandVerifierCodeState(cwd);

  return {
    ...startupReadyGitHead(codeState),
    dirtyState: startupReadyDirtyState(codeState),
    dirtyBreakdown: startupReadyDirtyBreakdown(codeState),
    fingerprint: codeState.fingerprint
  };
}

export function startupReadyGitHead(codeState: CommandVerifierCodeState): {
  gitHead?: string;
} {
  if (!codeState.available) {
    return {};
  }

  return {
    gitHead: codeState.gitHead ?? "unborn"
  };
}

export function startupReadyDirtyState(
  codeState: CommandVerifierCodeState
): StartupReadinessDirtyState {
  if (!codeState.available) {
    return "unknown";
  }

  return codeState.dirty ? "dirty" : "clean";
}

export function startupReadyDirtyBreakdown(
  codeState: CommandVerifierCodeState
): StartupReadinessDirtyBreakdown {
  if (!codeState.available) {
    return {
      productDirty: false,
      runsteadGeneratedDirty: false,
      ignoredRuntimeDirty: false,
      dependencyDirty: false,
      unknownDirty: true,
      productFiles: [],
      runsteadGeneratedFiles: [],
      ignoredRuntimeFiles: [],
      dependencyFiles: [],
      unknownFiles: []
    };
  }

  const productFiles: string[] = [];
  const runsteadGeneratedFiles: string[] = [];
  const ignoredRuntimeFiles: string[] = [];
  const dependencyFiles: string[] = [];
  const unknownFiles: string[] = [];

  for (const entry of codeState.changedFiles) {
    const path = entry.path;

    if (startupReadyRunsteadGeneratedPath(path)) {
      runsteadGeneratedFiles.push(path);
      continue;
    }

    if (startupReadyIgnoredRuntimePath(path)) {
      ignoredRuntimeFiles.push(path);
      continue;
    }

    if (startupReadyDependencyPath(path)) {
      dependencyFiles.push(path);
      continue;
    }

    if (path.length === 0) {
      unknownFiles.push(path);
      continue;
    }

    productFiles.push(path);
  }

  return {
    productDirty: productFiles.length > 0,
    runsteadGeneratedDirty: runsteadGeneratedFiles.length > 0,
    ignoredRuntimeDirty: ignoredRuntimeFiles.length > 0,
    dependencyDirty: dependencyFiles.length > 0,
    unknownDirty: unknownFiles.length > 0,
    productFiles,
    runsteadGeneratedFiles,
    ignoredRuntimeFiles,
    dependencyFiles,
    unknownFiles
  };
}

export function startupReadyRunsteadGeneratedPath(path: string): boolean {
  return (
    path === "AGENTS.json" ||
    path === "CLAUDE.json" ||
    path === "CODEX.json" ||
    path === "MEASUREMENT.json" ||
    path === "AGENTS.md" ||
    path === "CLAUDE.md" ||
    path === "CODEX.md" ||
    path === "MEASUREMENT.md"
  );
}

export function startupReadyIgnoredRuntimePath(path: string): boolean {
  return (
    path === ".runstead" ||
    path.startsWith(".runstead/") ||
    path === "dist" ||
    path.startsWith("dist/") ||
    path === "coverage" ||
    path.startsWith("coverage/") ||
    path === ".playwright-mcp" ||
    path.startsWith(".playwright-mcp/")
  );
}

export function startupReadyDependencyPath(path: string): boolean {
  return (
    path === "package.json" ||
    path.endsWith("/package.json") ||
    path === "pnpm-lock.yaml" ||
    path === "package-lock.json" ||
    path === "npm-shrinkwrap.json" ||
    path === "yarn.lock" ||
    path === "bun.lock" ||
    path === "bun.lockb"
  );
}
