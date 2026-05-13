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
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import {
  fetchGitHubWorkflowRunLog,
  getGitHubWorkflowRunStatus,
  type GitHubCliRunner,
  type GitHubWorkflowRunLog,
  type GitHubWorkflowRunStatus
} from "./github-actions.js";
import { listGoals } from "./goals.js";
import { requireRunsteadStateDbSync } from "./runstead-root.js";

export interface CreateCiRepairTaskOptions {
  cwd?: string;
  runId: string;
  runner?: GitHubCliRunner;
  now?: Date;
}

export interface CreateCiRepairTaskResult {
  cwd: string;
  stateDb: string;
  task: Task;
  event: RunsteadEvent;
  evidence: Evidence;
  evidencePath: string;
  workflowRun: GitHubWorkflowRunStatus;
  log: GitHubWorkflowRunLog;
}

const REPAIRABLE_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required"
]);

export async function createCiRepairTaskFromWorkflowRun(
  options: CreateCiRepairTaskOptions
): Promise<CreateCiRepairTaskResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedState = requireRunsteadStateDbSync(cwd);
  const createdAt = (options.now ?? new Date()).toISOString();
  const [workflowRun, log] = await Promise.all([
    getGitHubWorkflowRunStatus({
      cwd,
      runId: options.runId,
      ...(options.runner === undefined ? {} : { runner: options.runner })
    }),
    fetchGitHubWorkflowRunLog({
      cwd,
      runId: options.runId,
      ...(options.runner === undefined ? {} : { runner: options.runner })
    })
  ]);

  assertRepairableWorkflowRun(workflowRun);

  const goal = listGoals({ cwd }).goals.find(
    (candidate) =>
      candidate.domain === "repo-maintenance" && candidate.status === "active"
  );

  if (goal === undefined) {
    throw new Error("No active repo-maintenance goal found for CI repair");
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
      runId: workflowRun.runId,
      workflowRun,
      logEvidenceType: "github_workflow_run",
      repairPlan: {
        fetchLog: true,
        classifyFailure: true,
        runLocalVerifiers: true,
        createPullRequestWithEvidence: true
      }
    },
    verifiers: ["evidence:github_workflow_run", "command:local_verifiers"],
    createdAt,
    updatedAt: createdAt
  };
  const evidenceArtifact = {
    schemaVersion: 1,
    createdAt,
    taskId: task.id,
    goalId: task.goalId,
    workflowRun,
    log
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
    subjectId: task.id,
    uri: pathToFileURL(evidencePath).href,
    hash: sha256(evidenceContents),
    summary: workflowRunSummary(workflowRun, log),
    createdAt
  };
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "task.created",
    aggregateType: "task",
    aggregateId: task.id,
    payload: {
      goalId: task.goalId,
      type: task.type,
      runId: workflowRun.runId,
      workflowName: workflowRun.workflowName,
      conclusion: workflowRun.conclusion,
      evidenceId: evidence.id
    },
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
      taskId: task.id,
      uri: evidence.uri,
      hash: evidence.hash,
      summary: evidence.summary
    },
    createdAt
  };
  const database = openRunsteadDatabase(resolvedState.stateDb);

  await mkdir(evidenceDir, { recursive: true });
  await writeFile(evidencePath, evidenceContents, "utf8");

  try {
    appendEventAndProject(database, {
      event: evidenceEvent,
      projection: {
        type: "evidence",
        value: evidence
      }
    });
    appendEventAndProject(database, {
      event,
      projection: {
        type: "task",
        value: task
      }
    });
  } finally {
    database.close();
  }

  return {
    cwd,
    stateDb: resolvedState.stateDb,
    task,
    event,
    evidence,
    evidencePath,
    workflowRun,
    log
  };
}

export function formatCiRepairTaskReport(result: CreateCiRepairTaskResult): string {
  return [
    "Runstead CI repair task",
    `Task: ${result.task.id}`,
    `Run: ${result.workflowRun.runId}`,
    `Workflow: ${result.workflowRun.workflowName ?? "unknown"}`,
    `Conclusion: ${result.workflowRun.conclusion ?? "none"}`,
    `Evidence: ${result.evidence.id}`,
    `Log bytes: ${result.log.byteLength}`
  ].join("\n");
}

export function repairableWorkflowRunIdFromWebhook(
  event: string,
  payload: unknown
): string | undefined {
  if (event !== "workflow_run" || !isRecord(payload)) {
    return undefined;
  }

  const action = payload.action;
  const workflowRun = payload.workflow_run;

  if (action !== "completed" || !isRecord(workflowRun)) {
    return undefined;
  }

  const status = workflowRun.status;
  const conclusion = workflowRun.conclusion;
  const id = workflowRun.id;

  if (
    status !== "completed" ||
    typeof conclusion !== "string" ||
    !REPAIRABLE_CONCLUSIONS.has(conclusion)
  ) {
    return undefined;
  }

  if (typeof id === "number" || typeof id === "string") {
    return String(id);
  }

  return undefined;
}

function assertRepairableWorkflowRun(status: GitHubWorkflowRunStatus): void {
  if (status.status !== "completed") {
    throw new Error(`Workflow run ${status.runId} is ${status.status}, expected completed`);
  }

  if (
    status.conclusion === undefined ||
    !REPAIRABLE_CONCLUSIONS.has(status.conclusion)
  ) {
    throw new Error(
      `Workflow run ${status.runId} conclusion is ${status.conclusion ?? "none"}, expected repairable failure`
    );
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
