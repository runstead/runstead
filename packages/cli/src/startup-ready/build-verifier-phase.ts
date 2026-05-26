import { refreshStartupReadyCurrentContext } from "./context-phase.js";
import {
  executeStartupReadyMvpBuild,
  startupBuildMvpPhaseExecutionStatus,
  startupBuildMvpPhaseExecutionWarnings,
  startupReadyAutoRecoverBuildMvp,
  startupReadyGreenPathPreflight,
  writeStartupScaffoldProfileArtifact
} from "./build-mvp-phase.js";
import { ensureStartupReadyLocalMvpEvidence } from "./local-evidence.js";
import { emitStartupReadyPhaseResult, emitStartupReadyProgress } from "./progress.js";
import { writeStartupReadinessRun } from "./run-state.js";
import { collectRunEvidence, hasPhase, shouldRunPhase, updatePhase } from "./shared.js";
import { startupReadyVerifierPhaseUpdate } from "./verifier-phase.js";
import type { StartupReadinessRun, StartupReadyOptions } from "./types.js";

export async function executeStartupReadyBuildAndVerifierPhase(
  run: StartupReadinessRun,
  options: StartupReadyOptions
): Promise<void> {
  if (run.target === "local" && hasPhase(run, "build_mvp")) {
    await ensureStartupReadyLocalMvpEvidence(run, options.now ?? new Date());
  }

  if (!shouldRunPhase(run, "build_mvp") && !shouldRunPhase(run, "verifiers")) {
    return;
  }

  const greenPath = await startupReadyGreenPathPreflight(run, options);

  updatePhase(run, "build_mvp", { status: "running" });
  await writeStartupReadinessRun(run);
  emitStartupReadyProgress(run, options, {
    phaseId: "build_mvp",
    status: "started",
    message: greenPath.ok
      ? "verifying existing MVP without starting an agent worker"
      : "running bounded MVP build or repair loop"
  });
  const scaffoldArtifact =
    run.scaffoldProfile === undefined
      ? undefined
      : await writeStartupScaffoldProfileArtifact(run);
  const build = await executeStartupReadyMvpBuild({
    run,
    options,
    greenPath
  });
  const verifierPhase = await startupReadyVerifierPhaseUpdate(run, build, options);
  const initialBuildPhaseStatus = startupBuildMvpPhaseExecutionStatus(
    build.status,
    build.execution
  );
  const buildRecovery = startupReadyAutoRecoverBuildMvp({
    status: initialBuildPhaseStatus,
    execution: build.execution,
    verifierPhase: verifierPhase.update
  });
  const buildPhaseStatus = buildRecovery.status;
  const buildExecution = buildRecovery.execution;
  const buildWarnings = startupBuildMvpPhaseExecutionWarnings(buildExecution, {
    verifiedByCurrentEvidence: verifierPhase.verifiedByCurrentEvidence,
    verifierOnlyRecovery: buildRecovery.recovered
  });

  updatePhase(run, "build_mvp", {
    status: buildPhaseStatus,
    execution: buildExecution,
    warnings: buildWarnings,
    artifacts: scaffoldArtifact === undefined ? [] : [scaffoldArtifact],
    blockers:
      buildPhaseStatus === "passed"
        ? build.gate.blockers
        : [`worker finished with status ${build.status}`],
    nextAction:
      buildPhaseStatus === "passed"
        ? build.agentSkipped
          ? "existing MVP verified; skipped worker build"
          : buildRecovery.recovered
            ? "Runstead recovered without re-running the agent; current verifier evidence proves the MVP"
            : buildWarnings.length > 0
              ? "verified MVP despite worker completion warning; continue launch readiness"
              : build.status === "completed_with_warnings"
                ? "review MVP worker warnings and continue launch readiness"
                : "review MVP gate blockers and continue launch readiness"
        : verifierPhase.update.status === "passed"
          ? "Runstead can recover without re-running the agent; resume this readiness run for verifier-only evaluation"
          : "review worker output and resume startup readiness"
  });
  updatePhase(run, "verifiers", verifierPhase.update);
  await refreshStartupReadyCurrentContext(run, options);
  collectRunEvidence(run);
  await writeStartupReadinessRun(run);
  emitStartupReadyPhaseResult(run, options, "build_mvp");
  emitStartupReadyPhaseResult(run, options, "verifiers");
}
