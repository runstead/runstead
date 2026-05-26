import { executeStartupReadyUiSmoke } from "../startup-ready-ui-smoke.js";
import { emitStartupReadyPhaseResult, emitStartupReadyProgress } from "./progress.js";
import { writeStartupReadinessRun } from "./run-state.js";
import { collectRunEvidence, shouldRunPhase, unique, updatePhase } from "./shared.js";
import type { StartupReadinessRun, StartupReadyOptions } from "./types.js";
import {
  attemptStartupReadyUiSmokeRepair,
  startupReadyUiSmokeRepairWarnings
} from "./ui-smoke-phase.js";

export async function executeStartupReadyUiSmokePhase(
  run: StartupReadinessRun,
  options: StartupReadyOptions
): Promise<void> {
  if (!shouldRunPhase(run, "ui_smoke")) {
    return;
  }

  updatePhase(run, "ui_smoke", { status: "running" });
  await writeStartupReadinessRun(run);
  emitStartupReadyProgress(run, options, {
    phaseId: "ui_smoke",
    status: "started",
    message: "running local UI smoke checks"
  });
  let uiSmoke = await executeStartupReadyUiSmoke({
    cwd: run.cwd,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const uiSmokeRepair =
    uiSmoke.status === "blocked"
      ? await attemptStartupReadyUiSmokeRepair(run, options, uiSmoke)
      : undefined;

  if (uiSmokeRepair !== undefined) {
    uiSmoke = uiSmokeRepair.uiSmoke;

    if (uiSmokeRepair.verifierUpdate !== undefined) {
      updatePhase(run, "verifiers", uiSmokeRepair.verifierUpdate);
    }
  }

  updatePhase(run, "ui_smoke", {
    status: uiSmoke.status,
    evidenceIds: uiSmoke.evidenceIds,
    artifacts: unique([...(uiSmokeRepair?.artifacts ?? []), ...uiSmoke.artifacts]),
    ...(uiSmokeRepair === undefined
      ? {}
      : { warnings: startupReadyUiSmokeRepairWarnings(uiSmokeRepair) }),
    blockers:
      uiSmoke.status === "passed"
        ? []
        : unique([...(uiSmokeRepair?.blockers ?? []), ...uiSmoke.blockers]),
    nextAction:
      uiSmoke.status === "passed"
        ? uiSmokeRepair === undefined
          ? "continue launch readiness"
          : "automatic UI smoke repair passed; continue launch readiness"
        : uiSmokeRepair === undefined
          ? "fix UI smoke config or product flow and rerun startup ready"
          : "automatic UI smoke repair attempted; review repair artifact or resume startup ready"
  });
  collectRunEvidence(run);
  await writeStartupReadinessRun(run);
  emitStartupReadyPhaseResult(run, options, "ui_smoke");
}
