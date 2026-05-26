import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createRunsteadId,
  type Evidence,
  type JsonObject,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import {
  appendEventAndProject,
  openRunsteadDatabase,
  type RunsteadDatabase
} from "@runstead/state-sqlite";

import {
  fetchGitHubWorkflowRunLog,
  getGitHubWorkflowRunStatus,
  type GitHubCliRunner,
  type GitHubWorkflowRunLog,
  type GitHubWorkflowRunStatus
} from "./github-actions.js";
import { classifyCiFailure } from "./ci-repair-classification.js";
import {
  canRetryPartialCiRepairTask,
  findExistingCiRepairTaskForWorkflowRun,
  loadExistingCiRepairTaskResult
} from "./ci-repair-existing-task.js";
import { redactGitHubWorkflowRunLog } from "./ci-repair-log-redaction.js";
import { githubRunLogReadAction, githubRunReadAction } from "./ci-repair-actions.js";
import { runGovernedToolAction } from "./governed-action.js";
import { listGoals } from "./goals.js";
import { withRunsteadManagerLock } from "./manager-lock.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { requireRunsteadStateDbSync } from "./runstead-root.js";
import { finishWorkerRun, startWorkerRun } from "./runtime-audit.js";
import type { CommandVerifierInput } from "./verifier-evidence.js";
import {
  assertRepairableWorkflowRun,
  NonRepairableWorkflowRunError
} from "./ci-repair-workflow-run.js";

export interface CreateCiRepairTaskOptions {
  cwd?: string;
  runId: string;
  authToken?: string;
  runner?: GitHubCliRunner;
  verifierCommands?: CommandVerifierInput[];
  now?: Date;
}

export interface CreateCiRepairTaskResult {
  status: "created";
  cwd: string;
  stateDb: string;
  task: Task;
  event: RunsteadEvent;
  evidence: Evidence;
  evidencePath: string;
  workflowRun: GitHubWorkflowRunStatus;
  log: GitHubWorkflowRunLog;
  created: boolean;
}

export interface IgnoredCiRepairTaskResult {
  status: "ignored";
  reason: "workflow_not_repairable";
  taskStatus: "cancelled";
  cwd: string;
  stateDb: string;
  task: Task;
  event: RunsteadEvent;
  workflowRun: GitHubWorkflowRunStatus;
  log: GitHubWorkflowRunLog;
  created: boolean;
  error: string;
}

export type CreateCiRepairTaskFromWorkflowRunResult =
  | CreateCiRepairTaskResult
  | IgnoredCiRepairTaskResult;

const CI_LOG_EVIDENCE_METADATA = {
  trust: "untrusted_external",
  source: "github_actions_log",
  redacted: true,
  used_for_prompt: false
};

export { formatCiRepairTaskReport } from "./ci-repair-report.js";
export { repairableWorkflowRunIdFromWebhook } from "./ci-repair-workflow-run.js";

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

  const task: Task = {
    id: createRunsteadId("task"),
    goalId: goal.id,
    domain: "repo-maintenance",
    type: "ci_repair",
    status: "queued",
    priority: "high",
    attempt: 0,
    maxAttempts: 1,
    input: {
      source: "github_actions",
      runId: options.runId,
      intake: {
        governed: true
      },
      ...(options.verifierCommands === undefined
        ? {}
        : { commands: options.verifierCommands })
    },
    verifiers: [
      "evidence:github_workflow_run",
      ...(options.verifierCommands ?? []).map((command) => `command:${command.name}`),
      ...(options.verifierCommands === undefined ? ["command:local_verifiers"] : [])
    ],
    createdAt,
    updatedAt: createdAt
  };
  const taskCreatedEvent: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "task.created",
    aggregateType: "task",
    aggregateId: task.id,
    payload: {
      goalId: task.goalId,
      type: task.type,
      runId: options.runId,
      intake: "governed"
    },
    createdAt
  };
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
      const [workflowRunResult, logResult] = await Promise.all([
        runGovernedToolAction({
          cwd,
          stateDb: resolvedState.stateDb,
          database,
          policy,
          task,
          workerRun,
          action: githubRunReadAction({ task, cwd, runId: options.runId }),
          requestedBy: "runstead:ci-repair",
          ...(options.now === undefined ? {} : { now: options.now }),
          run: async () => {
            const value = await getGitHubWorkflowRunStatus({
              cwd,
              runId: options.runId,
              ...(options.authToken === undefined
                ? {}
                : { authToken: options.authToken }),
              ...(options.runner === undefined ? {} : { runner: options.runner })
            });

            return {
              value,
              output: {
                runId: value.runId,
                status: value.status,
                ...(value.conclusion === undefined
                  ? {}
                  : { conclusion: value.conclusion })
              }
            };
          }
        }),
        runGovernedToolAction({
          cwd,
          stateDb: resolvedState.stateDb,
          database,
          policy,
          task,
          workerRun,
          action: githubRunLogReadAction({ task, cwd, runId: options.runId }),
          requestedBy: "runstead:ci-repair",
          ...(options.now === undefined ? {} : { now: options.now }),
          run: async () => {
            const value = await fetchGitHubWorkflowRunLog({
              cwd,
              runId: options.runId,
              ...(options.authToken === undefined
                ? {}
                : { authToken: options.authToken }),
              ...(options.runner === undefined ? {} : { runner: options.runner })
            });

            return {
              value,
              output: {
                runId: value.runId,
                byteLength: value.byteLength,
                trust: CI_LOG_EVIDENCE_METADATA.trust
              }
            };
          }
        })
      ]);
      const workflowRun = workflowRunResult.value;
      const evidenceLog = redactGitHubWorkflowRunLog(logResult.value);
      const failureClassification = classifyCiFailure(workflowRun, evidenceLog);

      fetchedWorkflowRun = workflowRun;
      fetchedLog = evidenceLog;
      assertRepairableWorkflowRun(workflowRun);

      const finalTask: Task = {
        ...task,
        input: {
          source: "github_actions",
          runId: workflowRun.runId,
          workflowRun,
          logEvidenceType: "github_workflow_run",
          logEvidenceMetadata: CI_LOG_EVIDENCE_METADATA,
          failureClassification,
          repairPlan: {
            fetchLog: true,
            classifyFailure: true,
            runLocalVerifiers: true,
            createPullRequestWithEvidence: true
          },
          ...(options.verifierCommands === undefined
            ? {}
            : { commands: options.verifierCommands })
        },
        updatedAt: createdAt
      };
      const evidenceArtifact = {
        schemaVersion: 1,
        createdAt,
        taskId: finalTask.id,
        goalId: finalTask.goalId,
        metadata: CI_LOG_EVIDENCE_METADATA,
        workflowRun,
        failureClassification,
        log: evidenceLog
      };
      const evidenceContents = `${JSON.stringify(evidenceArtifact, null, 2)}\n`;
      const evidenceId = createRunsteadId("ev");
      const evidenceDir = join(resolvedState.root, "evidence");
      const evidencePath = join(
        evidenceDir,
        `github-workflow-run-${workflowRun.runId}-${evidenceId}.json`
      );
      const evidence: Evidence = {
        id: evidenceId,
        type: "github_workflow_run",
        subjectType: "task",
        subjectId: finalTask.id,
        uri: pathToFileURL(evidencePath).href,
        hash: sha256(evidenceContents),
        summary: workflowRunSummary(workflowRun, evidenceLog),
        createdAt
      };
      const evidenceEvent: RunsteadEvent = {
        eventId: createRunsteadId("evt"),
        type: "evidence.recorded",
        aggregateType: "evidence",
        aggregateId: evidence.id,
        payload: {
          evidenceId: evidence.id,
          evidenceType: evidence.type,
          taskId: finalTask.id,
          uri: evidence.uri,
          hash: evidence.hash,
          summary: evidence.summary,
          metadata: CI_LOG_EVIDENCE_METADATA
        },
        createdAt
      };

      await mkdir(evidenceDir, { recursive: true });
      await writeFile(evidencePath, evidenceContents, "utf8");
      appendEventAndProject(database, {
        event: evidenceEvent,
        projection: {
          type: "evidence",
          value: evidence
        }
      });
      appendEventAndProject(database, {
        event: {
          eventId: createRunsteadId("evt"),
          type: "task.updated",
          aggregateType: "task",
          aggregateId: finalTask.id,
          payload: {
            runId: workflowRun.runId,
            workflowName: workflowRun.workflowName,
            conclusion: workflowRun.conclusion,
            failureCategory: failureClassification.category,
            evidenceId: evidence.id
          },
          createdAt
        },
        projection: {
          type: "task",
          value: finalTask
        }
      });
      finishWorkerRun({
        database,
        workerRun,
        status: "completed",
        output: {
          runId: workflowRun.runId,
          evidenceId: evidence.id
        },
        ...(options.now === undefined ? {} : { now: options.now })
      });

      return {
        status: "created",
        cwd,
        stateDb: resolvedState.stateDb,
        task: finalTask,
        event: taskCreatedEvent,
        evidence,
        evidencePath,
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

function workflowRunSummary(
  status: GitHubWorkflowRunStatus,
  log: GitHubWorkflowRunLog
): string {
  return [
    status.workflowName ?? "GitHub workflow",
    status.conclusion ?? status.status,
    `run ${status.runId}`,
    `${log.byteLength} log bytes`
  ].join(" ");
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function markCiRepairTaskTerminal(input: {
  database: RunsteadDatabase;
  task: Task;
  status: "cancelled" | "failed";
  error: unknown;
  now?: Date;
}): Task {
  const updatedAt = (input.now ?? new Date()).toISOString();
  const output: JsonObject = {
    error: errorMessage(input.error)
  };
  const task: Task = {
    ...input.task,
    status: input.status,
    output,
    updatedAt
  };

  appendEventAndProject(input.database, {
    event: {
      eventId: createRunsteadId("evt"),
      type: `task.${input.status}`,
      aggregateType: "task",
      aggregateId: task.id,
      payload: output,
      createdAt: updatedAt
    },
    projection: {
      type: "task",
      value: task
    }
  });

  return task;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
