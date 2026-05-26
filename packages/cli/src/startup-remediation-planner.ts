import { resolve } from "node:path";

import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { generateLaunchReadinessReport } from "./launch-readiness-report.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { checkStartupGate } from "./startup-evidence.js";
import {
  prioritizedBlockers,
  remediationNextCommands,
  uniqueBlockers
} from "./startup-remediation-guidance.js";
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
  GenerateStartupRemediationPlanOptions,
  GenerateStartupRemediationPlanResult,
  StartupRemediationTaskSummary
} from "./startup-remediation-types.js";
import { listTasks } from "./tasks.js";

const STARTUP_DOMAIN = "ai-native-startup";

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
