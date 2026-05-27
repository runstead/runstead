import { join, resolve } from "node:path";

import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import {
  type GitHubWorkflowRunLog,
  type GitHubWorkflowRunStatus
} from "./github-actions.js";
import {
  canRetryPartialCiRepairTask,
  findExistingCiRepairTaskForWorkflowRun,
  loadExistingCiRepairTaskResult
} from "./ci-repair-existing-task.js";
import { completeCiRepairWorkflowRunIntake } from "./ci-repair-intake-completion.js";
import { fetchCiRepairWorkflowRunIntake } from "./ci-repair-intake-fetch.js";
import { createQueuedCiRepairTask } from "./ci-repair-task-create.js";
import { errorMessage, markCiRepairTaskTerminal } from "./ci-repair-task-state.js";
import { listGoals } from "./goals.js";
import { withRunsteadManagerLock } from "./manager-lock.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { requireRunsteadStateDbSync } from "./runstead-root.js";
import { finishWorkerRun, startWorkerRun } from "./runtime-audit.js";
import type {
  CreateCiRepairTaskFromWorkflowRunResult,
  CreateCiRepairTaskOptions,
  CreateCiRepairTaskResult
} from "./ci-repair-types.js";
import {
  assertRepairableWorkflowRun,
  NonRepairableWorkflowRunError
} from "./ci-repair-workflow-run.js";

export { formatCiRepairTaskReport } from "./ci-repair-report.js";
export { repairableWorkflowRunIdFromWebhook } from "./ci-repair-workflow-run.js";
export type {
  CreateCiRepairTaskFromWorkflowRunResult,
  CreateCiRepairTaskOptions,
  CreateCiRepairTaskResult,
  IgnoredCiRepairTaskResult
} from "./ci-repair-types.js";

export async function createCiRepairTaskFromWorkflowRun(
  options: CreateCiRepairTaskOptions
): Promise<CreateCiRepairTaskFromWorkflowRunResult> {
  return withRunsteadManagerLock(options, () =>
    createCiRepairTaskFromWorkflowRunUnlocked(options)
  );
}

export async function createCiRepairTaskFromWorkflowRunUnlocked(
  options: CreateCiRepairTaskOptions
): Promise<CreateCiRepairTaskFromWorkflowRunResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedState = requireRunsteadStateDbSync(cwd);
  const createdAt = (options.now ?? new Date()).toISOString();
  const goal = listGoals({ cwd }).goals.find(
    (candidate) =>
      candidate.domain === "repo-maintenance" && candidate.status === "active"
  );

  if (goal === undefined) {
    throw new Error("No active repo-maintenance goal found for CI repair");
  }

  const existingTask = findExistingCiRepairTaskForWorkflowRun({
    cwd,
    runId: options.runId
  });

  if (existingTask !== undefined) {
    const existing = await loadExistingCiRepairTaskResult({
      cwd,
      stateDb: resolvedState.stateDb,
      task: existingTask
    });

    if (existing !== undefined) {
      return existing;
    }

    if (!canRetryPartialCiRepairTask(existingTask)) {
      throw new Error(
        `CI repair task already exists for workflow run ${options.runId}: ${existingTask.id}`
      );
    }
  }

  const { task, event: taskCreatedEvent } = createQueuedCiRepairTask({
    goalId: goal.id,
    runId: options.runId,
    ...(options.verifierCommands === undefined
      ? {}
      : { verifierCommands: options.verifierCommands }),
    createdAt
  });
  const database = openRunsteadDatabase(resolvedState.stateDb);
  let fetchedWorkflowRun: GitHubWorkflowRunStatus | undefined;
  let fetchedLog: GitHubWorkflowRunLog | undefined;

  try {
    appendEventAndProject(database, {
      event: taskCreatedEvent,
      projection: {
        type: "task",
        value: task
      }
    });

    const policy = await loadPolicyProfileFromFile(
      join(resolvedState.root, "policies", "repo-maintenance.yaml")
    );
    const workerRun = startWorkerRun({
      database,
      task,
      workerType: "ci_repair_intake",
      enforcementLevel: "policy_enforced",
      ...(options.now === undefined ? {} : { now: options.now })
    });

    try {
      const intake = await fetchCiRepairWorkflowRunIntake({
        cwd,
        stateDb: resolvedState.stateDb,
        database,
        policy,
        task,
        workerRun,
        runId: options.runId,
        ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
        ...(options.runner === undefined ? {} : { runner: options.runner }),
        ...(options.now === undefined ? {} : { now: options.now })
      });
      const { workflowRun, failureClassification } = intake;
      const evidenceLog = intake.log;

      fetchedWorkflowRun = workflowRun;
      fetchedLog = evidenceLog;
      assertRepairableWorkflowRun(workflowRun);

      const completed = await completeCiRepairWorkflowRunIntake({
        database,
        runsteadRoot: resolvedState.root,
        task,
        workflowRun,
        failureClassification,
        ...(options.verifierCommands === undefined
          ? {}
          : { verifierCommands: options.verifierCommands }),
        log: evidenceLog,
        createdAt
      });
      finishWorkerRun({
        database,
        workerRun,
        status: "completed",
        output: {
          runId: workflowRun.runId,
          evidenceId: completed.evidence.id
        },
        ...(options.now === undefined ? {} : { now: options.now })
      });

      return {
        status: "created",
        cwd,
        stateDb: resolvedState.stateDb,
        task: completed.task,
        event: taskCreatedEvent,
        evidence: completed.evidence,
        evidencePath: completed.evidencePath,
        workflowRun,
        log: evidenceLog,
        created: true
      };
    } catch (error) {
      const notRepairable = error instanceof NonRepairableWorkflowRunError;

      const terminalTask = markCiRepairTaskTerminal({
        database,
        task,
        status: notRepairable ? "cancelled" : "failed",
        error,
        ...(options.now === undefined ? {} : { now: options.now })
      });
      finishWorkerRun({
        database,
        workerRun,
        status: notRepairable ? "completed" : "failed",
        output: {
          error: errorMessage(error),
          ...(notRepairable ? { reason: "workflow_not_repairable" } : {})
        },
        ...(options.now === undefined ? {} : { now: options.now })
      });

      if (
        notRepairable &&
        fetchedWorkflowRun !== undefined &&
        fetchedLog !== undefined
      ) {
        return {
          status: "ignored",
          reason: "workflow_not_repairable",
          taskStatus: "cancelled",
          cwd,
          stateDb: resolvedState.stateDb,
          task: terminalTask,
          event: taskCreatedEvent,
          workflowRun: fetchedWorkflowRun,
          log: fetchedLog,
          created: true,
          error: errorMessage(error)
        };
      }

      throw error;
    }
  } finally {
    database.close();
  }
}

export function isCreatedCiRepairTaskResult(
  result: CreateCiRepairTaskFromWorkflowRunResult
): result is CreateCiRepairTaskResult {
  return result.status === "created";
}
