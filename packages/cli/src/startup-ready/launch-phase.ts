import { startupLaunchCheck, startupScaleCheck } from "../startup-founder-flow.js";
import { ensureStartupReadyLocalLaunchEvidence } from "./local-evidence.js";
import { emitStartupReadyPhaseResult, emitStartupReadyProgress } from "./progress.js";
import { writeStartupReadinessRun } from "./run-state.js";
import {
  collectRunEvidence,
  hasPhase,
  shouldRunPhase,
  unique,
  updatePhase
} from "./shared.js";
import type { StartupReadinessRun, StartupReadyOptions } from "./types.js";

export async function executeStartupReadyLaunchPhase(
  run: StartupReadinessRun,
  options: StartupReadyOptions
): Promise<void> {
  if (run.target === "local" && hasPhase(run, "launch_audit")) {
    await ensureStartupReadyLocalLaunchEvidence(run, options.now ?? new Date());
  }

  if (shouldRunPhase(run, "launch_audit") || shouldRunPhase(run, "launch_report")) {
    updatePhase(run, "launch_audit", { status: "running" });
    updatePhase(run, "launch_report", { status: "running" });
    await writeStartupReadinessRun(run);
    emitStartupReadyProgress(run, options, {
      phaseId: "launch_audit",
      status: "started",
      message: "running launch audit and security checks"
    });
    emitStartupReadyProgress(run, options, {
      phaseId: "launch_report",
      status: "started",
      message: "building launch readiness report"
    });
    const launch = await startupLaunchCheck({
      cwd: run.cwd,
      target: run.target,
      ...(options.now === undefined ? {} : { now: options.now })
    });
    const auditBlockers = [...launch.readiness.blockers, ...launch.security.blockers];

    updatePhase(run, "launch_audit", {
      status: auditBlockers.length === 0 ? "passed" : "blocked",
      evidenceIds: [launch.readiness.evidenceId, launch.security.evidenceId],
      artifacts: [...launch.readiness.files, ...launch.security.files],
      blockers: auditBlockers
    });
    updatePhase(run, "launch_report", {
      status: launch.status === "launch_ready" ? "passed" : "blocked",
      artifacts: [launch.reportPath],
      blockers: launch.blockers,
      nextAction:
        launch.status === "launch_ready"
          ? "run scale or complete readiness"
          : "resolve launch blockers and rerun startup ready"
    });
    run.reportPaths = unique([...run.reportPaths, launch.reportPath]);
    collectRunEvidence(run);
    await writeStartupReadinessRun(run);
    emitStartupReadyPhaseResult(run, options, "launch_audit");
    emitStartupReadyPhaseResult(run, options, "launch_report");
  }

  if (run.stage === "scale") {
    await startupScaleCheck({
      cwd: run.cwd,
      ...(options.now === undefined ? {} : { now: options.now })
    });
  }
}
