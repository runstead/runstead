import { resolve } from "node:path";

import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { generateLaunchReadinessReport } from "./launch-readiness-report.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  prioritizedBlockers,
  remediationNextCommands,
  uniqueBlockers
} from "./startup-remediation-guidance.js";
import { checkStartupGate } from "./startup-evidence.js";
import { remediationExecutionOutcome } from "./startup-remediation-execution.js";
import {
  remediationPlanGraph,
  remediationTaskSummary,
  withRemediationDependencies
} from "./startup-remediation-plan-graph.js";
import {
  activeStartupGoal,
  buildRemediationTask,
  REMEDIATION_TASK_TYPE,
  reusableRemediationTask,
  taskCreatedEvent
} from "./startup-remediation-task-state.js";
import type {
  ExecuteStartupRemediationPlanOptions,
  ExecuteStartupRemediationPlanResult,
  GenerateStartupRemediationPlanOptions,
  GenerateStartupRemediationPlanResult,
  StartupRemediationBudget,
  StartupRemediationExecutionSummary,
  StartupRemediationTaskSummary
} from "./startup-remediation-types.js";
import { executeRemediationTask } from "./startup-remediation-runner.js";
import { listTasks } from "./tasks.js";

const STARTUP_DOMAIN = "ai-native-startup";

export {
  formatStartupRemediationExecution,
  formatStartupRemediationPlan
} from "./startup-remediation-format.js";
export { supersedeStartupRemediationTasks } from "./startup-remediation-supersede.js";
export type * from "./startup-remediation-types.js";

export async function generateStartupRemediationPlan(
  options: GenerateStartupRemediationPlanOptions = {}
): Promise<GenerateStartupRemediationPlanResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const domain = options.domain ?? STARTUP_DOMAIN;
  const stage = options.stage ?? "launch";
  const now = options.now ?? new Date();
  const createdAt = now.toISOString();
  const resolvedState = await requireRunsteadStateDb(cwd);
  const report =
    stage === "launch"
      ? await generateLaunchReadinessReport({ cwd, domain, now })
      : undefined;
  const gate = await checkStartupGate({ cwd, domain, stage, now });
  const blockers = prioritizedBlockers(
    uniqueBlockers([...(report?.blockers ?? []), ...gate.blockers])
  );
  const goal = activeStartupGoal({ cwd, domain });
  const existingTasks = listTasks({ cwd }).tasks.filter(
    (task) => task.domain === domain && task.type === REMEDIATION_TASK_TYPE
  );
  const createdTasks: StartupRemediationTaskSummary[] = [];
  const database = openRunsteadDatabase(resolvedState.stateDb);

  try {
    for (const blocker of blockers) {
      const existing = reusableRemediationTask(existingTasks, stage, blocker);

      if (existing !== undefined) {
        createdTasks.push(
          remediationTaskSummary({
            task: existing,
            blocker,
            reused: true,
            gate
          })
        );
        continue;
      }

      const task = buildRemediationTask({
        goal,
        stage,
        blocker,
        createdAt,
        ...(report?.reportPath === undefined ? {} : { reportPath: report.reportPath })
      });
      const event = taskCreatedEvent(task, blocker, createdAt);

      appendEventAndProject(database, {
        event,
        projection: {
          type: "task",
          value: task
        }
      });
      existingTasks.push(task);
      createdTasks.push(
        remediationTaskSummary({
          task,
          blocker,
          reused: false,
          gate
        })
      );
    }
  } finally {
    database.close();
  }
  const plannedTasks = withRemediationDependencies(createdTasks);

  return {
    root: resolvedState.root,
    stateDb: resolvedState.stateDb,
    domain,
    stage,
    status: blockers.length === 0 ? "clear" : "blocked",
    blockers,
    ...(report?.reportPath === undefined ? {} : { reportPath: report.reportPath }),
    tasks: plannedTasks,
    plan: remediationPlanGraph(plannedTasks),
    nextCommands: remediationNextCommands(stage)
  };
}

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
