import {
  startupLaunchCheck,
  startupOnboard,
  startupScaleCheck
} from "../startup-founder-flow.js";
import { executeStartupReadinessExtensions } from "../startup-extension-execution.js";
import { generateStartupCompleteProductCheck } from "../startup-complete-check.js";
import { supersedeStartupRemediationTasks } from "../startup-remediation.js";
import { executeStartupReadyUiSmoke } from "../startup-ready-ui-smoke.js";
import { planStartupReady } from "./plan.js";
import { readStartupReadinessRun, writeStartupReadinessRun } from "./run-state.js";
import {
  createStartupReadinessRun,
  recoverStartupReadyStaleTasks
} from "./lifecycle.js";
import type {
  RunStartupReadyResult,
  StartupReadinessRun,
  StartupReadyOptions
} from "./types.js";
import {
  collectRunEvidence,
  errorMessage,
  hasPhase,
  isStartupReadyVerdict,
  resetResumablePhase,
  shouldRunPhase,
  startupReadinessRunGovernanceProfile,
  startupReadyStageToGateStage,
  unique,
  updatePhase
} from "./shared.js";
import {
  collectStartupReadyInteractiveAnswers,
  startupReadyInteractiveFounderFlowOptions
} from "./options.js";
import { refreshStartupReadyCurrentContext } from "./context-phase.js";
import { emitStartupReadyPhaseResult, emitStartupReadyProgress } from "./progress.js";
import {
  ensureStartupReadyLocalLaunchEvidence,
  ensureStartupReadyLocalMvpEvidence
} from "./local-evidence.js";
import {
  executeStartupReadyMvpBuild,
  startupBuildMvpPhaseExecutionStatus,
  startupBuildMvpPhaseExecutionWarnings,
  startupReadyAutoRecoverBuildMvp,
  startupReadyGreenPathPreflight,
  writeStartupScaffoldProfileArtifact
} from "./build-mvp-phase.js";
import {
  startupReadyVerifierPhaseUpdate,
  startupReadyExtensionWarnings
} from "./verifier-phase.js";
import {
  attemptStartupReadyUiSmokeRepair,
  startupReadyUiSmokeRepairWarnings
} from "./ui-smoke-phase.js";
import { finalizeRun } from "./finalize.js";
import {
  startupCompleteProductArtifacts,
  writeStartupReadinessCiOutputs,
  writeStartupReadinessDecisionReport
} from "./report-phase.js";

export {
  defaultStartupReadyUiSmokeConfig,
  executeStartupReadyUiSmoke,
  inferStartupReadyUiSmokeExpectText,
  inferStartupReadyUiSmokeFlowActions
} from "../startup-ready-ui-smoke.js";
export type {
  StartupReadyUiSmokeCheckConfig,
  StartupReadyUiSmokeCheckResult,
  StartupReadyUiSmokeConfig,
  StartupReadyUiSmokeRunResult,
  StartupReadyUiSmokeServerConfig
} from "../startup-ready-ui-smoke.js";
export { planStartupReady } from "./plan.js";
export {
  formatStartupReadyPlan,
  formatStartupReadyProgress,
  formatStartupReadinessRun
} from "./format.js";
export {
  parseStartupReadyGovernanceProfile,
  parseStartupReadyStage,
  parseStartupReadyTarget
} from "./options.js";
export { evaluateStartupReadinessVerdict } from "./decision.js";
export { startupBuildMvpPhaseExecutionStatus } from "./build-mvp-phase.js";
export {
  buildStartupReadyGuidedFlow,
  buildStartupReadyOperatorCommands
} from "./operator-actions.js";
export { readStartupReadinessRun, writeStartupReadinessRun } from "./run-state.js";
export { createStartupReadinessRun } from "./lifecycle.js";
export { STARTUP_READINESS_EVIDENCE_TIERS } from "./types.js";
export type * from "./types.js";

export async function runStartupReady(
  options: StartupReadyOptions = {}
): Promise<RunStartupReadyResult> {
  await recoverStartupReadyStaleTasks(options);

  const resumed =
    options.resumeRunId === undefined
      ? undefined
      : await readStartupReadinessRun({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          runId: options.resumeRunId
        });
  const plan =
    resumed === undefined
      ? await planStartupReady(options)
      : await planStartupReady({
          cwd: resumed.run.cwd,
          stage: resumed.run.stage,
          target: resumed.run.target,
          worker: resumed.run.worker,
          governanceProfile: startupReadinessRunGovernanceProfile(resumed.run),
          ...(resumed.run.scaffoldProfile?.template === undefined
            ? {}
            : { appTemplate: resumed.run.scaffoldProfile.template }),
          ...(resumed.run.scaffoldProfile?.appType === undefined
            ? {}
            : { appType: resumed.run.scaffoldProfile.appType }),
          ...(options.now === undefined ? {} : { now: options.now })
        });
  const persisted = resumed ?? (await createStartupReadinessRun(options));
  const persistedRun = { ...persisted.run };
  delete persistedRun.completedAt;
  const run = {
    ...persistedRun,
    status: "running" as const,
    phases: persisted.run.phases.map(resetResumablePhase)
  };

  await writeStartupReadinessRun(run);
  emitStartupReadyProgress(run, options, {
    status: "started",
    message: `startup ready run started for ${run.stage}/${run.target}`
  });

  try {
    await executeStartupReadyRun(run, options);
  } catch (error) {
    const failedRun = {
      ...run,
      status: "failed" as const,
      completedAt: (options.now ?? new Date()).toISOString()
    };

    await writeStartupReadinessRun(failedRun);
    emitStartupReadyProgress(failedRun, options, {
      status: "failed",
      message: `startup ready run failed: ${errorMessage(error)}`,
      blockers: [errorMessage(error)]
    });
    throw error;
  }

  const finalRun = await finalizeRun(run, options.now ?? new Date(), {
    extraEvidenceTiers: options.ci === true ? ["ci_verified"] : [],
    ...(options.sourceConnectorEnv === undefined
      ? {}
      : { sourceConnectorEnv: options.sourceConnectorEnv })
  });
  if (isStartupReadyVerdict(finalRun.verdict)) {
    await supersedeStartupRemediationTasks({
      cwd: finalRun.cwd,
      stage: startupReadyStageToGateStage(finalRun.stage),
      activeBlockers: finalRun.verdictBlockers,
      runId: finalRun.id,
      now: options.now ?? new Date()
    });
  }
  let reportedRun = await writeStartupReadinessDecisionReport(
    finalRun,
    options.now ?? new Date()
  );

  if (options.ci === true) {
    reportedRun = await writeStartupReadinessCiOutputs(
      reportedRun,
      options.now ?? new Date()
    );
  }

  const finalPersisted = await writeStartupReadinessRun(reportedRun);
  emitStartupReadyProgress(reportedRun, options, {
    status: isStartupReadyVerdict(reportedRun.verdict) ? "completed" : "blocked",
    message: `startup ready run finished with ${reportedRun.verdict}`,
    evidenceIds: reportedRun.evidenceIds,
    artifacts: reportedRun.reportPaths,
    blockers: reportedRun.verdictBlockers
  });

  return {
    ...finalPersisted,
    plan
  };
}

async function executeStartupReadyRun(
  run: StartupReadinessRun,
  options: StartupReadyOptions
): Promise<void> {
  const interactiveAnswers = await collectStartupReadyInteractiveAnswers(options);

  if (
    shouldRunPhase(run, "onboard") ||
    shouldRunPhase(run, "context") ||
    shouldRunPhase(run, "measurement")
  ) {
    updatePhase(run, "onboard", { status: "running" });
    await writeStartupReadinessRun(run);
    emitStartupReadyProgress(run, options, {
      phaseId: "onboard",
      status: "started",
      message: "initializing Runstead startup context and measurement"
    });
    const onboard = await startupOnboard({
      cwd: run.cwd,
      writeCi: options.writeCi === true,
      force: options.refreshContext === true,
      ...(options.writeTrackedContext === undefined
        ? {}
        : { writeTrackedContext: options.writeTrackedContext }),
      ...startupReadyInteractiveFounderFlowOptions(interactiveAnswers),
      ...(options.now === undefined ? {} : { now: options.now })
    });

    updatePhase(run, "onboard", {
      status: "passed",
      artifacts: [
        ...onboard.onboardingFiles,
        ...(onboard.repo.ci.path === undefined ? [] : [onboard.repo.ci.path])
      ]
    });
    updatePhase(run, "context", {
      status: onboard.context.status === "generated" ? "passed" : "skipped",
      evidenceIds:
        onboard.context.result === undefined ? [] : [onboard.context.result.evidenceId],
      artifacts: onboard.context.result?.files ?? [],
      blockers:
        onboard.context.status === "generated"
          ? []
          : [onboard.context.reason ?? "context generation skipped"]
    });
    updatePhase(run, "measurement", {
      status: onboard.measurement.status === "generated" ? "passed" : "skipped",
      evidenceIds:
        onboard.measurement.result === undefined
          ? []
          : [onboard.measurement.result.evidenceId],
      artifacts: onboard.measurement.result?.files ?? [],
      blockers:
        onboard.measurement.status === "generated"
          ? []
          : [onboard.measurement.reason ?? "measurement generation skipped"]
    });
    collectRunEvidence(run);
    await writeStartupReadinessRun(run);
    emitStartupReadyPhaseResult(run, options, "onboard");
    emitStartupReadyPhaseResult(run, options, "context");
    emitStartupReadyPhaseResult(run, options, "measurement");
  }

  if (run.target === "local" && hasPhase(run, "build_mvp")) {
    await ensureStartupReadyLocalMvpEvidence(run, options.now ?? new Date());
  }

  if (shouldRunPhase(run, "build_mvp") || shouldRunPhase(run, "verifiers")) {
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

  if (shouldRunPhase(run, "ui_smoke")) {
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

  if (shouldRunPhase(run, "extensions")) {
    updatePhase(run, "extensions", { status: "running" });
    await writeStartupReadinessRun(run);
    emitStartupReadyProgress(run, options, {
      phaseId: "extensions",
      status: "started",
      message: "running extension collectors"
    });
    const extensions = await executeStartupReadinessExtensions({
      cwd: run.cwd,
      target: run.target,
      stage: startupReadyStageToGateStage(run.stage),
      worker: run.worker,
      governanceProfile: run.governanceProfile,
      ...(options.now === undefined ? {} : { now: options.now })
    });

    updatePhase(run, "extensions", {
      status: extensions.status,
      evidenceIds: extensions.evidenceIds,
      artifacts: extensions.artifacts,
      blockers: extensions.blockers,
      warnings: startupReadyExtensionWarnings(extensions),
      nextAction:
        extensions.status === "passed"
          ? "continue launch readiness"
          : "resolve extension collector blockers and rerun startup ready"
    });
    collectRunEvidence(run);
    await writeStartupReadinessRun(run);
    emitStartupReadyPhaseResult(run, options, "extensions");
  }

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

  if (shouldRunPhase(run, "complete_check")) {
    updatePhase(run, "complete_check", { status: "running" });
    await writeStartupReadinessRun(run);
    emitStartupReadyProgress(run, options, {
      phaseId: "complete_check",
      status: "started",
      message: "running complete product readiness check"
    });
    const provisional = await finalizeRun(run, options.now ?? new Date());
    const complete = await generateStartupCompleteProductCheck({
      cwd: run.cwd,
      target: run.target,
      readiness: {
        verdict: provisional.verdict,
        blockers: provisional.verdictBlockers
      },
      ...(options.now === undefined ? {} : { now: options.now })
    });

    const completeArtifacts = startupCompleteProductArtifacts(complete);

    updatePhase(run, "complete_check", {
      status: complete.status === "complete" ? "passed" : "blocked",
      evidenceIds: [complete.evidenceId],
      artifacts: completeArtifacts,
      blockers: complete.criteria.flatMap((criterion) => criterion.missing),
      nextAction:
        complete.status === "complete"
          ? "ship with recorded evidence"
          : "resolve complete-product missing evidence and rerun startup ready"
    });
    run.reportPaths = unique([...run.reportPaths, ...completeArtifacts]);
    collectRunEvidence(run);
    await writeStartupReadinessRun(run);
    emitStartupReadyPhaseResult(run, options, "complete_check");
  }
}
