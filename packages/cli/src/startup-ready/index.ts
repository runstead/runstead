import { supersedeStartupRemediationTasks } from "../startup-remediation.js";
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
  errorMessage,
  isStartupReadyVerdict,
  resetResumablePhase,
  startupReadinessRunGovernanceProfile,
  startupReadyStageToGateStage
} from "./shared.js";
import { executeStartupReadyOnboardingPhase } from "./onboarding-phase.js";
import { executeStartupReadyRuntimeBackendPhase } from "./runtime-backend-phase.js";
import { emitStartupReadyProgress } from "./progress.js";
import { executeStartupReadyBuildAndVerifierPhase } from "./build-verifier-phase.js";
import { executeStartupReadyCompleteCheckPhase } from "./complete-check-phase.js";
import { executeStartupReadyExtensionsPhase } from "./extensions-phase.js";
import { executeStartupReadyLaunchPhase } from "./launch-phase.js";
import { executeStartupReadyUiSmokePhase } from "./ui-smoke-execution-phase.js";
import { finalizeRun } from "./finalize.js";
import {
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
  await executeStartupReadyUiSmokePhase(run, options);
  await executeStartupReadyExtensionsPhase(run, options);
  await executeStartupReadyLaunchPhase(run, options);
  await executeStartupReadyCompleteCheckPhase(run, options);
}
