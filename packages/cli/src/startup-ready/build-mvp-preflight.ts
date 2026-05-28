import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { collectRepoInspection } from "../inspection-evidence.js";
import { resolveRunsteadRoot } from "../runstead-root.js";
import { STARTUP_READY_APP_SURFACE_NAMES } from "./constants.js";
import { hasPhase, optionalStat } from "./shared.js";
import type { StartupReadinessRun, StartupReadyOptions } from "./types.js";

export interface StartupReadyGreenPathPreflight {
  ok: boolean;
  blockers: string[];
}

export async function startupReadyGreenPathPreflight(
  run: StartupReadinessRun,
  options: StartupReadyOptions
): Promise<StartupReadyGreenPathPreflight> {
  if (options.forceBuild === true) {
    return {
      ok: false,
      blockers: ["force build requested"]
    };
  }

  const [inspection, hasAppSurface, hasUiSmokeConfig] = await Promise.all([
    collectRepoInspection(run.cwd, (options.now ?? new Date()).toISOString()),
    hasStartupReadyApplicationSurface(run.cwd),
    hasStartupReadyUiSmokeConfig(run)
  ]);
  const blockers = [
    hasAppSurface ? undefined : "application surface is missing",
    inspection.commands.test.detected ? undefined : "test command is missing",
    inspection.commands.lint.detected ? undefined : "lint command is missing",
    inspection.commands.typecheck.detected ? undefined : "typecheck command is missing",
    inspection.commands.build.detected ? undefined : "build command is missing",
    hasPhase(run, "ui_smoke") && !hasUiSmokeConfig
      ? "UI smoke config is missing"
      : undefined
  ].filter((blocker): blocker is string => blocker !== undefined);

  return {
    ok: blockers.length === 0,
    blockers
  };
}

export async function hasStartupReadyUiSmokeConfig(
  run: StartupReadinessRun
): Promise<boolean> {
  if (!hasPhase(run, "ui_smoke")) {
    return true;
  }

  const root = await resolveRunsteadRoot(run.cwd);

  return (
    (await optionalStat(join(root.root, "startup", "ui-smoke.yaml"))) !== undefined
  );
}

export async function hasStartupReadyApplicationSurface(cwd: string): Promise<boolean> {
  try {
    const entries = await readdir(cwd, { withFileTypes: true });

    return entries.some((entry) => STARTUP_READY_APP_SURFACE_NAMES.has(entry.name));
  } catch {
    return false;
  }
}
