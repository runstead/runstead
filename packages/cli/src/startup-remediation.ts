import { resolve } from "node:path";

import { generateLaunchReadinessReport } from "./launch-readiness-report.js";
import { checkStartupGate } from "./startup-evidence.js";
import { remediationExecutionOutcome } from "./startup-remediation-execution.js";
import { generateStartupRemediationPlan } from "./startup-remediation-planner.js";
import type {
  ExecuteStartupRemediationPlanOptions,
  ExecuteStartupRemediationPlanResult,
  StartupRemediationBudget,
  StartupRemediationExecutionSummary
} from "./startup-remediation-types.js";
import { executeRemediationTask } from "./startup-remediation-runner.js";

const STARTUP_DOMAIN = "ai-native-startup";

export {
  formatStartupRemediationExecution,
  formatStartupRemediationPlan
} from "./startup-remediation-format.js";
export { generateStartupRemediationPlan } from "./startup-remediation-planner.js";
export { supersedeStartupRemediationTasks } from "./startup-remediation-supersede.js";
export type * from "./startup-remediation-types.js";

export async function executeStartupRemediationPlan(
  options: ExecuteStartupRemediationPlanOptions = {}
): Promise<ExecuteStartupRemediationPlanResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const domain = options.domain ?? STARTUP_DOMAIN;
  const stage = options.stage ?? "launch";
  const worker = options.worker ?? "codex_cli";
  const plan = await generateStartupRemediationPlan({
    cwd,
    domain,
    stage,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const executionTargets =
    options.maxTasks === undefined ? plan.tasks : plan.tasks.slice(0, options.maxTasks);
  const executed: StartupRemediationExecutionSummary[] = [];
  const budget: StartupRemediationBudget = {
    ...(options.maxTasks === undefined ? {} : { maxTasks: options.maxTasks }),
    selectedTasks: executionTargets.length,
    skippedTasks: Math.max(0, plan.tasks.length - executionTargets.length)
  };

  for (const item of executionTargets) {
    const execution = await executeRemediationTask({
      cwd,
      domain,
      stage,
      worker,
      item,
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.workerRunner === undefined
        ? {}
        : { workerRunner: options.workerRunner }),
      ...(options.workerProgressIntervalMs === undefined
        ? {}
        : { workerProgressIntervalMs: options.workerProgressIntervalMs }),
      ...(options.onWorkerProgress === undefined
        ? {}
        : { onWorkerProgress: options.onWorkerProgress }),
      ...(options.now === undefined ? {} : { now: options.now })
    });

    executed.push(execution);
  }

  const finalGate = await checkStartupGate({
    cwd,
    domain,
    stage,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const finalReport =
    stage === "launch"
      ? await generateLaunchReadinessReport({
          cwd,
          domain,
          ...(options.now === undefined ? {} : { now: options.now })
        })
      : undefined;

  return {
    ...plan,
    status: finalGate.passed ? "clear" : "blocked",
    blockers: finalGate.blockers,
    worker,
    executed,
    finalGate: {
      passed: finalGate.passed,
      blockers: finalGate.blockers,
      warnings: finalGate.warnings,
      eventId: finalGate.event.eventId
    },
    executionOutcome: remediationExecutionOutcome(finalGate.passed, executed),
    budget,
    ...(finalReport?.reportPath === undefined
      ? {}
      : { finalReportPath: finalReport.reportPath })
  };
}
