import { join } from "node:path";
import { readinessRunGovernanceProfile as runtimeReadinessRunGovernanceProfile } from "@runstead/runtime";

import type { ResolvedStartupWorkerGovernanceProfile } from "../startup-founder-flow.js";
import {
  collectCommandVerifierCodeState,
  type CommandVerifierCodeState
} from "../verifier-evidence.js";
import type {
  StartupReadinessDirtyBreakdown,
  StartupReadinessDirtyState,
  StartupReadinessEvidenceTier,
  StartupReadinessPhaseStatus,
  StartupReadinessRun,
  StartupReadinessRunPhase,
  StartupReadinessVerdict,
  StartupReadyStage
} from "./types.js";

export function startupReadinessRunGovernanceProfile(
  run: Pick<StartupReadinessRun, "worker"> & {
    governanceProfile?: ResolvedStartupWorkerGovernanceProfile;
  }
): ResolvedStartupWorkerGovernanceProfile {
  const profile = runtimeReadinessRunGovernanceProfile(run);

  return profile === "governed" ? "governed" : "readiness";
}

export function phaseStatus(
  run: StartupReadinessRun,
  id: string
): StartupReadinessPhaseStatus | undefined {
  return run.phases.find((phase) => phase.id === id)?.status;
}

export function startupReadyStageToGateStage(
  stage: StartupReadyStage
): "mvp" | "launch" | "scale" {
  if (stage === "mvp") {
    return "mvp";
  }

  if (stage === "scale") {
    return "scale";
  }

  return "launch";
}

export function isStartupReadyVerdict(verdict: StartupReadinessVerdict): boolean {
  return verdict.endsWith("_ready");
}

export function formatStartupDirtyBreakdown(
  breakdown: StartupReadinessDirtyBreakdown | undefined
): string {
  if (breakdown === undefined) {
    return "unknown";
  }

  const categories = [
    breakdown.productDirty ? `product:${breakdown.productFiles.length}` : undefined,
    breakdown.runsteadGeneratedDirty
      ? `runstead_generated:${breakdown.runsteadGeneratedFiles.length}`
      : undefined,
    breakdown.ignoredRuntimeDirty
      ? `runtime:${breakdown.ignoredRuntimeFiles.length}`
      : undefined,
    breakdown.dependencyDirty
      ? `dependency:${breakdown.dependencyFiles.length}`
      : undefined,
    breakdown.unknownDirty ? `unknown:${breakdown.unknownFiles.length}` : undefined
  ].filter((item): item is string => item !== undefined);

  return categories.length === 0 ? "clean" : categories.join(", ");
}

export function updatePhase(
  run: StartupReadinessRun,
  id: string,
  update: Partial<StartupReadinessRunPhase>
): void {
  const phase = run.phases.find((candidate) => candidate.id === id);

  if (phase === undefined) {
    return;
  }

  Object.assign(phase, {
    ...update,
    evidenceIds: update.evidenceIds ?? phase.evidenceIds,
    artifacts: update.artifacts ?? phase.artifacts,
    blockers: update.blockers ?? phase.blockers,
    warnings: update.warnings ?? phase.warnings
  });
}

export function resetResumablePhase(
  phase: StartupReadinessRunPhase
): StartupReadinessRunPhase {
  if (phase.status === "passed" || phase.status === "skipped") {
    return phase;
  }

  const rest = { ...phase };
  delete rest.nextAction;

  return {
    ...rest,
    status: "pending",
    blockers: []
  };
}

export function hasPhase(run: StartupReadinessRun, id: string): boolean {
  return run.phases.some((phase) => phase.id === id);
}

export function shouldRunPhase(run: StartupReadinessRun, id: string): boolean {
  const phase = run.phases.find((candidate) => candidate.id === id);

  return phase !== undefined && phase.status !== "passed" && phase.status !== "skipped";
}

export function collectRunEvidence(run: StartupReadinessRun): void {
  run.evidenceIds = unique(run.phases.flatMap((phase) => phase.evidenceIds));
  run.evidenceTiers = uniqueEvidenceTiers([
    ...run.evidenceTiers,
    ...inferPhaseEvidenceTiers(run)
  ]);
  run.reportPaths = unique([
    ...run.reportPaths,
    ...run.phases.flatMap((phase) => phase.artifacts).filter(isReportPath)
  ]);
}

export function inferPhaseEvidenceTiers(
  run: Pick<StartupReadinessRun, "phases">
): StartupReadinessEvidenceTier[] {
  return uniqueEvidenceTiers(
    run.phases.flatMap((phase) => {
      if (phase.evidenceIds.length === 0) {
        return [];
      }

      if (phase.id === "verifiers") {
        return ["local_command"];
      }

      if (phase.id === "ui_smoke") {
        return ["synthetic_smoke"];
      }

      if (phase.id === "launch_audit") {
        return ["local_command", "security_scan"];
      }

      return [];
    })
  );
}

function isReportPath(path: string): boolean {
  return path.includes("/reports/") || path.endsWith(".md") || path.endsWith(".json");
}

export function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function uniqueEvidenceTiers(
  values: StartupReadinessEvidenceTier[]
): StartupReadinessEvidenceTier[] {
  return [...new Set(values)];
}

export function startupReadyShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export function startupReadinessRunsDir(root: string): string {
  return join(root, "startup", "readiness-runs");
}

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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? undefined : trimmed;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function optionalStat(
  path: string
): Promise<{ mtimeMs: number } | undefined> {
  try {
    const { stat } = await import("node:fs/promises");

    return await stat(path);
  } catch {
    return undefined;
  }
}
