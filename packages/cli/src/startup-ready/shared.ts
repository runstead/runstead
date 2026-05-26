import { join } from "node:path";
import { readinessRunGovernanceProfile as runtimeReadinessRunGovernanceProfile } from "@runstead/runtime";

import type { ResolvedStartupWorkerGovernanceProfile } from "../startup-founder-flow.js";
import type {
  StartupReadinessDirtyBreakdown,
  StartupReadinessEvidenceTier,
  StartupReadinessPhaseStatus,
  StartupReadinessRun,
  StartupReadinessRunPhase,
  StartupReadinessVerdict,
  StartupReadyStage
} from "./types.js";

export {
  collectStartupReadyCodeState,
  startupReadyDependencyPath,
  startupReadyDirtyBreakdown,
  startupReadyDirtyState,
  startupReadyGitHead,
  startupReadyIgnoredRuntimePath,
  startupReadyRunsteadGeneratedPath
} from "./code-state.js";

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
