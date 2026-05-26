import { resolve } from "node:path";

import { createRunsteadId, type Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  REMEDIATION_TASK_TYPE,
  stringValue,
  terminalRemediationTaskStatuses
} from "./startup-remediation-task-state.js";
import type {
  SupersedeStartupRemediationTasksOptions,
  SupersedeStartupRemediationTasksResult
} from "./startup-remediation-types.js";
import { listTasks } from "./tasks.js";

const STARTUP_DOMAIN = "ai-native-startup";

export async function supersedeStartupRemediationTasks(
  options: SupersedeStartupRemediationTasksOptions
): Promise<SupersedeStartupRemediationTasksResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const domain = options.domain ?? STARTUP_DOMAIN;
  const stage = options.stage ?? "launch";
  const activeBlockers = new Set(options.activeBlockers ?? []);
  const updatedAt = (options.now ?? new Date()).toISOString();
  const resolvedState = await requireRunsteadStateDb(cwd);
  const tasks = listTasks({ cwd }).tasks.filter(
    (task) =>
      task.domain === domain &&
      task.type === REMEDIATION_TASK_TYPE &&
      task.input.stage === stage &&
      !terminalRemediationTaskStatuses().has(task.status) &&
      !activeBlockers.has(stringValue(task.input.blocker))
  );
  const database = openRunsteadDatabase(resolvedState.stateDb);
  const supersededTasks: Task[] = [];

  try {
    for (const task of tasks) {
      const superseded: Task = {
        ...task,
        status: "cancelled",
        output: {
          ...task.output,
          superseded: {
            byRunId: options.runId,
            reason:
              activeBlockers.size === 0
                ? "latest startup readiness verdict has no active blockers"
                : "startup readiness blocker is no longer active",
            activeBlockers: [...activeBlockers]
          }
        },
        updatedAt
      };

      appendEventAndProject(database, {
        event: {
          eventId: createRunsteadId("evt"),
          type: "task.superseded",
          aggregateType: "task",
          aggregateId: task.id,
          payload: superseded.output ?? {},
          createdAt: updatedAt
        },
        projection: {
          type: "task",
          value: superseded
        }
      });
      supersededTasks.push(superseded);
    }
  } finally {
    database.close();
  }

  return {
    root: resolvedState.root,
    stateDb: resolvedState.stateDb,
    supersededTasks
  };
}
