import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createRunsteadId,
  EvidenceSchema,
  type Evidence,
  type JsonObject,
  type RunsteadEvent,
  RunsteadEventSchema,
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
import { runGovernedToolAction } from "./governed-action.js";
import { listGoals } from "./goals.js";
import { withRunsteadManagerLock } from "./manager-lock.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import type { ActionEnvelope } from "./policy.js";
import { requireRunsteadStateDbSync } from "./runstead-root.js";
import { finishWorkerRun, startWorkerRun } from "./runtime-audit.js";
import { listTasks } from "./tasks.js";
import type { CommandVerifierInput } from "./verifier-evidence.js";

export interface CreateCiRepairTaskOptions {
  cwd?: string;
  runId: string;
  runner?: GitHubCliRunner;
  verifierCommands?: CommandVerifierInput[];
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
  created: boolean;
}

interface CiFailureClassification extends JsonObject {
  category:
    | "build"
    | "cancelled"
    | "dependency_install"
    | "lint"
    | "test"
    | "timeout"
    | "typecheck"
    | "unknown";
  summary: string;
  confidence: number;
  matchedSignals: string[];
}

const REPAIRABLE_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required"
]);
const CI_LOG_EVIDENCE_METADATA = {
  trust: "untrusted_external",
  source: "github_actions_log",
  redacted: true,
  used_for_prompt: false
};

export async function createCiRepairTaskFromWorkflowRun(
  options: CreateCiRepairTaskOptions
): Promise<CreateCiRepairTaskResult> {
  return withRunsteadManagerLock(options, () =>
    createGovernedCiRepairTaskFromWorkflowRun(options)
  );
}

async function createGovernedCiRepairTaskFromWorkflowRun(
  options: CreateCiRepairTaskOptions
): Promise<CreateCiRepairTaskResult> {
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
      markCiRepairTaskFailed({
        database,
        task,
        error,
        ...(options.now === undefined ? {} : { now: options.now })
      });
      finishWorkerRun({
        database,
        workerRun,
        status: "failed",
        output: {
          error: errorMessage(error)
        },
        ...(options.now === undefined ? {} : { now: options.now })
      });

      throw error;
    }
  } finally {
    database.close();
  }
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

function findExistingCiRepairTaskForWorkflowRun(input: {
  cwd: string;
  runId: string;
}): Task | undefined {
  return listTasks({ cwd: input.cwd }).tasks.find(
    (task) =>
      task.domain === "repo-maintenance" &&
      task.type === "ci_repair" &&
      String(task.input.runId) === input.runId
  );
}

async function loadExistingCiRepairTaskResult(input: {
  cwd: string;
  stateDb: string;
  task: Task;
}): Promise<CreateCiRepairTaskResult | undefined> {
  const database = openRunsteadDatabase(input.stateDb);

  try {
    const evidenceRow = database
      .prepare(
        `
        SELECT id, type, subject_type, subject_id, uri, hash, summary, created_at
        FROM evidence
        WHERE subject_type = 'task' AND subject_id = ? AND type = 'github_workflow_run'
        ORDER BY created_at DESC, id ASC
        LIMIT 1
      `
      )
      .get(input.task.id) as EvidenceRow | undefined;
    const eventRow = database
      .prepare(
        `
        SELECT event_id, type, aggregate_type, aggregate_id, payload_json, created_at
        FROM events
        WHERE aggregate_type = 'task' AND aggregate_id = ? AND type = 'task.created'
        ORDER BY id ASC
        LIMIT 1
      `
      )
      .get(input.task.id) as EventRow | undefined;

    if (evidenceRow === undefined || eventRow === undefined) {
      return undefined;
    }

    const evidence = rowToEvidence(evidenceRow);
    const evidencePath = evidencePathFromUri(evidence.uri);

    if (evidencePath === undefined) {
      return undefined;
    }

    const artifact = JSON.parse(await readFile(evidencePath, "utf8")) as {
      workflowRun?: unknown;
      log?: unknown;
    };

    if (!isRecord(artifact.workflowRun) || !isRecord(artifact.log)) {
      return undefined;
    }

    return {
      cwd: input.cwd,
      stateDb: input.stateDb,
      task: input.task,
      event: rowToRunsteadEvent(eventRow),
      evidence,
      evidencePath,
      workflowRun: artifact.workflowRun as unknown as GitHubWorkflowRunStatus,
      log: artifact.log as unknown as GitHubWorkflowRunLog,
      created: false
    };
  } finally {
    database.close();
  }
}

function canRetryPartialCiRepairTask(task: Task): boolean {
  return task.status === "failed" || task.status === "cancelled";
}

interface EvidenceRow {
  id: string;
  type: string;
  subject_type: string;
  subject_id: string;
  uri: string;
  hash: string | null;
  summary: string | null;
  created_at: string;
}

interface EventRow {
  event_id: string;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload_json: string;
  created_at: string;
}

function rowToEvidence(row: EvidenceRow): Evidence {
  return EvidenceSchema.parse({
    id: row.id,
    type: row.type,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    uri: row.uri,
    ...(row.hash === null ? {} : { hash: row.hash }),
    ...(row.summary === null ? {} : { summary: row.summary }),
    createdAt: row.created_at
  });
}

function rowToRunsteadEvent(row: EventRow): RunsteadEvent {
  return RunsteadEventSchema.parse({
    eventId: row.event_id,
    type: row.type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    payload: JSON.parse(row.payload_json) as JsonObject,
    createdAt: row.created_at
  });
}

function evidencePathFromUri(uri: string): string | undefined {
  try {
    const url = new URL(uri);

    return url.protocol === "file:" ? fileURLToPath(url) : undefined;
  } catch {
    return undefined;
  }
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
    throw new Error(
      `Workflow run ${status.runId} is ${status.status}, expected completed`
    );
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

function classifyCiFailure(
  status: GitHubWorkflowRunStatus,
  log: GitHubWorkflowRunLog
): CiFailureClassification {
  const text = `${status.conclusion ?? ""}\n${status.workflowName ?? ""}\n${log.log}`;
  const normalized = text.toLowerCase();

  if (
    status.conclusion === "timed_out" ||
    hasAny(normalized, ["timed out", "timeout"])
  ) {
    return classification("timeout", "Workflow run timed out", 0.9, ["timeout"]);
  }

  if (
    status.conclusion === "cancelled" ||
    hasAny(normalized, ["cancelled", "canceled"])
  ) {
    return classification("cancelled", "Workflow run was cancelled", 0.9, [
      "cancelled"
    ]);
  }

  if (
    hasAny(normalized, [
      "npm err!",
      "pnpm err",
      "yarn error",
      "lockfile",
      "cannot find module",
      "dependency",
      "failed to install"
    ])
  ) {
    return classification(
      "dependency_install",
      "Dependency installation or resolution failed",
      0.75,
      ["dependency_install"]
    );
  }

  if (hasAny(normalized, ["eslint", "lint failed", "lint error"])) {
    return classification("lint", "Lint verification failed", 0.75, ["lint"]);
  }

  if (
    /\bts\d{4}\b/i.test(text) ||
    hasAny(normalized, ["typecheck", "type error", "tsc"])
  ) {
    return classification("typecheck", "Type checking failed", 0.75, ["typecheck"]);
  }

  if (
    hasAny(normalized, ["test failed", "failing test", "expected", "received", "fail "])
  ) {
    return classification("test", "Test verification failed", 0.7, ["test"]);
  }

  if (
    hasAny(normalized, ["build failed", "compilation failed", "vite build", "webpack"])
  ) {
    return classification("build", "Build failed", 0.65, ["build"]);
  }

  return classification("unknown", "Workflow failed; cause not classified", 0.2, [
    "unknown"
  ]);
}

function classification(
  category: CiFailureClassification["category"],
  summary: string,
  confidence: number,
  matchedSignals: string[]
): CiFailureClassification {
  return {
    category,
    summary,
    confidence,
    matchedSignals
  };
}

function hasAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function markCiRepairTaskFailed(input: {
  database: RunsteadDatabase;
  task: Task;
  error: unknown;
  now?: Date;
}): Task {
  const updatedAt = (input.now ?? new Date()).toISOString();
  const output: JsonObject = {
    error: errorMessage(input.error)
  };
  const task: Task = {
    ...input.task,
    status: "failed",
    output,
    updatedAt
  };

  appendEventAndProject(input.database, {
    event: {
      eventId: createRunsteadId("evt"),
      type: "task.failed",
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

function redactGitHubWorkflowRunLog(log: GitHubWorkflowRunLog): GitHubWorkflowRunLog {
  const redactedLog = redactSecretLikeValues(log.log);

  return {
    ...log,
    log: redactedLog,
    byteLength: Buffer.byteLength(redactedLog)
  };
}

function redactSecretLikeValues(value: string): string {
  return value
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]")
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY)[A-Z0-9_]*)=([^\s]+)/gi,
      "$1=[REDACTED]"
    );
}

function githubRunReadAction(input: {
  task: Task;
  cwd: string;
  runId: string;
}): ActionEnvelope {
  return {
    actionId: stableActionId("github_run_read", [input.task.id, input.runId]),
    actionType: "github.run.read",
    resource: {
      type: "workflow_run",
      id: input.runId
    },
    context: {
      cwd: input.cwd,
      networkDomains: ["github.com"]
    }
  };
}

function githubRunLogReadAction(input: {
  task: Task;
  cwd: string;
  runId: string;
}): ActionEnvelope {
  return {
    actionId: stableActionId("github_run_log_read", [input.task.id, input.runId]),
    actionType: "github.run.log.read",
    resource: {
      type: "workflow_run",
      id: input.runId
    },
    context: {
      cwd: input.cwd,
      networkDomains: ["github.com"]
    }
  };
}

function stableActionId(prefix: string, parts: unknown[]): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 12);

  return `act_${prefix}_${hash}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
