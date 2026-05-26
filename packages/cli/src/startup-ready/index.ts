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
  isStartupReadyVerdict,
  resetResumablePhase,
  shouldRunPhase,
  startupReadinessRunGovernanceProfile,
  startupReadyStageToGateStage,
  unique,
  updatePhase
} from "./shared.js";
import { executeStartupReadyOnboardingPhase } from "./onboarding-phase.js";
import { executeStartupReadyRuntimeBackendPhase } from "./runtime-backend-phase.js";
import { emitStartupReadyPhaseResult, emitStartupReadyProgress } from "./progress.js";
import { executeStartupReadyBuildAndVerifierPhase } from "./build-verifier-phase.js";
import { executeStartupReadyExtensionsPhase } from "./extensions-phase.js";
import { executeStartupReadyLaunchPhase } from "./launch-phase.js";
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
  if (!(await executeStartupReadyRuntimeBackendPhase(run, options))) {
    return;
  }

  await executeStartupReadyOnboardingPhase(run, options);
  await executeStartupReadyBuildAndVerifierPhase(run, options);

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

  await executeStartupReadyExtensionsPhase(run, options);
  await executeStartupReadyLaunchPhase(run, options);

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
