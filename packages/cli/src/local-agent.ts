import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

import {
  createRunsteadId,
  type Goal,
  type JsonObject,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import {
  appendEventAndProject,
  openRunsteadDatabase,
  type RunsteadDatabase
} from "@runstead/state-sqlite";

import type { CiRepairWorkerKind } from "./ci-repair-orchestrator.js";
import {
  CODEX_DIRECT_WORKER_KIND,
  createCodexDirectTransport,
  runCodexDirectWorker,
  type CodexDirectTransport,
  type CodexDirectWorkerResult
} from "./codex-direct-worker.js";
import { resolveCodexRuntimeCredentials } from "./codex-auth.js";
import {
  runGovernedToolAction,
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "./governed-action.js";
import { showGoal } from "./goals.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import type { ActionEnvelope, PolicyProfile } from "./policy.js";
import { requireRunsteadRoot, requireRunsteadStateDb } from "./runstead-root.js";
import { finishWorkerRun, startWorkerRun } from "./runtime-audit.js";
import { claimTask } from "./tasks.js";
import type { CommandVerifierInput } from "./verifier-evidence.js";

export const LOCAL_AGENT_TASK_TYPE = "local_agent_task";

export type LocalAgentMode = "read-only" | "edit" | "repair";
export type LocalAgentWorkerKind = CiRepairWorkerKind;

export interface CreateLocalAgentTaskOptions {
  cwd?: string;
  prompt: string;
  title?: string;
  worker?: LocalAgentWorkerKind;
  model?: string;
  mode?: LocalAgentMode;
  allowedPaths?: string[];
  deniedPaths?: string[];
  verifierCommands?: CommandVerifierInput[];
  maxTurns?: number;
  checkpoint?: boolean;
  commit?: boolean;
  now?: Date;
}

export interface CreateLocalAgentTaskResult {
  stateDb: string;
  goal: Goal;
  task: Task;
  events: RunsteadEvent[];
}

export interface RunLocalAgentTaskOptions {
  cwd?: string;
  taskId: string;
  transport?: CodexDirectTransport;
  now?: Date;
}

export interface RunLocalAgentTaskResult {
  cwd: string;
  task: Task;
  goal: Goal;
  workerResult?: CodexDirectWorkerResult;
  status: "completed" | "waiting_approval" | "blocked" | "failed";
  summary: string;
  approval?: CodexDirectWorkerResult["approval"];
}

export async function createLocalAgentTask(
  options: CreateLocalAgentTaskOptions
): Promise<CreateLocalAgentTaskResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const prompt = requireNonEmptyString(options.prompt, "prompt");
  const mode = options.mode ?? "read-only";
  const worker = options.worker ?? "codex_direct";
  const resolvedState = await requireRunsteadStateDb(cwd);
  const createdAt = (options.now ?? new Date()).toISOString();
  const goal: Goal = {
    id: createRunsteadId("goal"),
    domain: "repo-maintenance",
    title: options.title ?? localAgentTitle(prompt),
    status: "active",
    priority: mode === "read-only" ? "low" : "medium",
    scope: {
      repositoryPath: cwd,
      taskType: LOCAL_AGENT_TASK_TYPE,
      mode,
      worker
    },
    policyRef: "policy_repo_maintenance_v1",
    createdAt,
    updatedAt: createdAt
  };
  const task: Task = {
    id: createRunsteadId("task"),
    goalId: goal.id,
    domain: goal.domain,
    type: LOCAL_AGENT_TASK_TYPE,
    status: "queued",
    priority: goal.priority,
    attempt: 0,
    maxAttempts: 1,
    input: localAgentTaskInput({
      cwd,
      prompt,
      worker,
      mode,
      options
    }),
    verifiers: (options.verifierCommands ?? []).map(
      (command) => `command:${command.name}`
    ),
    createdAt,
    updatedAt: createdAt
  };
  const goalEvent = localAgentEvent("goal.created", "goal", goal.id, createdAt, {
    domain: goal.domain,
    title: goal.title,
    repositoryPath: cwd,
    taskType: LOCAL_AGENT_TASK_TYPE,
    mode,
    worker
  });
  const taskEvent = localAgentEvent("task.created", "task", task.id, createdAt, {
    goalId: task.goalId,
    type: task.type,
    mode,
    worker
  });
  const database = openRunsteadDatabase(resolvedState.stateDb);

  try {
    appendEventAndProject(database, {
      event: goalEvent,
      projection: {
        type: "goal",
        value: goal
      }
    });
    appendEventAndProject(database, {
      event: taskEvent,
      projection: {
        type: "task",
        value: task
      }
    });
  } finally {
    database.close();
  }

  return {
    stateDb: resolvedState.stateDb,
    goal,
    task,
    events: [goalEvent, taskEvent]
  };
}

export function isLocalAgentTask(task: Task): boolean {
  return task.domain === "repo-maintenance" && task.type === LOCAL_AGENT_TASK_TYPE;
}

export async function runLocalAgentTask(
  options: RunLocalAgentTaskOptions
): Promise<RunLocalAgentTaskResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const root = await requireRunsteadRoot(cwd);
  const state = await requireRunsteadStateDb(cwd);
  const claimedTask = claimTask({
    cwd,
    id: options.taskId,
    ...(options.now === undefined ? {} : { now: options.now })
  }).task;

  if (!isLocalAgentTask(claimedTask)) {
    throw new Error(`Task ${options.taskId} is not a local agent task`);
  }

  if (localAgentTaskWorker(claimedTask) !== CODEX_DIRECT_WORKER_KIND) {
    throw new Error("Local agent task execution currently supports codex_direct only");
  }

  if (localAgentTaskMode(claimedTask) !== "read-only") {
    throw new Error("Local agent task execution currently supports read-only mode only");
  }

  const model = localAgentTaskModel(claimedTask);

  if (model === undefined) {
    throw new Error("--model is required when --worker codex_direct is used");
  }

  const startedAt = (options.now ?? new Date()).toISOString();
  const runningTask: Task = {
    ...claimedTask,
    status: "running",
    attempt: claimedTask.attempt + 1,
    updatedAt: startedAt
  };
  const goal = showGoal({ cwd, id: runningTask.goalId }).goal;
  const policy = await loadPolicyProfileFromFile(
    join(root.root, "policies", "repo-maintenance.yaml")
  );
  const transport = options.transport ?? (await createDefaultCodexDirectTransport(options));
  const database = openRunsteadDatabase(state.stateDb);

  try {
    appendEventAndProject(database, {
      event: localAgentEvent(
        "task.started",
        "task",
        runningTask.id,
        startedAt,
        {
          previousStatus: claimedTask.status,
          attempt: runningTask.attempt
        }
      ),
      projection: {
        type: "task",
        value: runningTask
      }
    });

    return await runLocalAgentTaskWithDatabase({
      cwd,
      root: root.root,
      stateDb: state.stateDb,
      database,
      policy,
      goal,
      task: runningTask,
      model,
      transport,
      ...(options.now === undefined ? {} : { now: options.now })
    });
  } finally {
    database.close();
  }
}

async function runLocalAgentTaskWithDatabase(options: {
  cwd: string;
  root: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  goal: Goal;
  task: Task;
  model: string;
  transport: CodexDirectTransport;
  now?: Date;
}): Promise<RunLocalAgentTaskResult> {
  const orchestratorRun = startWorkerRun({
    database: options.database,
    task: options.task,
    workerType: "local_agent_orchestrator",
    enforcementLevel: "policy_enforced",
    ...(options.now === undefined ? {} : { now: options.now })
  });

  try {
    const governed = await runGovernedToolAction({
      cwd: options.cwd,
      stateDb: options.stateDb,
      database: options.database,
      policy: options.policy,
      task: options.task,
      workerRun: orchestratorRun,
      action: workerStartAction({
        task: options.task,
        cwd: options.cwd,
        worker: CODEX_DIRECT_WORKER_KIND
      }),
      requestedBy: "runstead:local-agent",
      ...(options.now === undefined ? {} : { now: options.now }),
      run: async () => {
        const maxTurns = localAgentTaskMaxTurns(options.task);
        const value = await runCodexDirectWorker({
          cwd: options.cwd,
          stateDb: options.stateDb,
          database: options.database,
          policy: options.policy,
          goal: options.goal,
          task: options.task,
          model: options.model,
          evidenceDir: join(options.root, "evidence"),
          transport: options.transport,
          prompt: buildLocalAgentPrompt(options.task),
          ...(maxTurns === undefined ? {} : { maxTurns }),
          ...(options.now === undefined ? {} : { now: options.now })
        });

        return {
          value,
          output: localAgentWorkerOutput(value)
        };
      }
    });
    const workerResult = governed.value;
    const finalStatus = localAgentTaskStatus(workerResult.status);
    const finalTask = finalizeLocalAgentTask({
      database: options.database,
      task: options.task,
      status: finalStatus,
      output: localAgentTaskOutput(workerResult),
      ...(options.now === undefined ? {} : { now: options.now })
    });

    finishWorkerRun({
      database: options.database,
      workerRun: orchestratorRun,
      status: workerResult.status === "completed" ? "completed" : workerResult.status,
      output: localAgentWorkerOutput(workerResult),
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return {
      cwd: options.cwd,
      task: finalTask,
      goal: options.goal,
      workerResult,
      status: workerResult.status,
      summary: workerResult.summary,
      ...(workerResult.approval === undefined ? {} : { approval: workerResult.approval })
    };
  } catch (error) {
    const failure = localAgentFailureFromError(error);
    const finalTask = finalizeLocalAgentTask({
      database: options.database,
      task: options.task,
      status: failure.taskStatus,
      output: failure.output,
      ...(options.now === undefined ? {} : { now: options.now })
    });

    finishWorkerRun({
      database: options.database,
      workerRun: orchestratorRun,
      status: failure.workerStatus,
      output: failure.output,
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return {
      cwd: options.cwd,
      task: finalTask,
      goal: options.goal,
      status: failure.resultStatus,
      summary: String(failure.output.summary),
      ...(failure.approval === undefined ? {} : { approval: failure.approval })
    };
  }
}

export function formatLocalAgentRunReport(result: RunLocalAgentTaskResult): string {
  return [
    "Runstead agent run",
    `Task: ${result.task.id}`,
    `Status: ${result.status}`,
    ...(result.workerResult === undefined
      ? []
      : [
          `Worker: ${result.workerResult.worker}`,
          `Model: ${result.workerResult.model}`,
          `Tool calls: ${result.workerResult.toolCalls}`
        ]),
    ...(result.approval === undefined
      ? []
      : [`Approval: waiting ${result.approval.id}`]),
    `Summary: ${result.summary}`
  ].join("\n");
}

export function localAgentRunExitCode(result: RunLocalAgentTaskResult): number {
  return result.status === "completed" ? 0 : 1;
}

function localAgentTaskInput(input: {
  cwd: string;
  prompt: string;
  worker: LocalAgentWorkerKind;
  mode: LocalAgentMode;
  options: CreateLocalAgentTaskOptions;
}): Task["input"] {
  return {
    repositoryPath: input.cwd,
    prompt: input.prompt,
    worker: input.worker,
    mode: input.mode,
    ...(input.options.model === undefined ? {} : { model: input.options.model }),
    ...(input.options.allowedPaths === undefined
      ? {}
      : { allowedPaths: input.options.allowedPaths }),
    ...(input.options.deniedPaths === undefined
      ? {}
      : { deniedPaths: input.options.deniedPaths }),
    ...(input.options.verifierCommands === undefined
      ? {}
      : { commands: input.options.verifierCommands }),
    ...(input.options.maxTurns === undefined ? {} : { maxTurns: input.options.maxTurns }),
    ...(input.options.checkpoint === undefined
      ? {}
      : { checkpoint: input.options.checkpoint }),
    ...(input.options.commit === undefined ? {} : { commit: input.options.commit })
  };
}

async function createDefaultCodexDirectTransport(options: {
  now?: Date;
}): Promise<CodexDirectTransport> {
  const credentials = await resolveCodexRuntimeCredentials({
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return createCodexDirectTransport({
    baseUrl: credentials.baseUrl,
    accessToken: credentials.accessToken
  });
}

function buildLocalAgentPrompt(task: Task): string {
  const prompt = requiredTaskString(task, "prompt");

  return [
    prompt,
    "",
    "Runstead local-agent mode:",
    `- mode: ${localAgentTaskMode(task)}`,
    "- Read-only mode must not call write_file or run_command.",
    "- Use git_status, git_diff, and read_file when useful.",
    "- End with a concise summary of what you inspected and any risks or next steps."
  ].join("\n");
}

function finalizeLocalAgentTask(input: {
  database: RunsteadDatabase;
  task: Task;
  status: Task["status"];
  output: JsonObject;
  now?: Date;
}): Task {
  const updatedAt = (input.now ?? new Date()).toISOString();
  const task: Task = {
    ...input.task,
    status: input.status,
    output: input.output,
    updatedAt
  };

  appendEventAndProject(input.database, {
    event: localAgentEvent(`task.${input.status}`, "task", task.id, updatedAt, {
      previousStatus: input.task.status,
      ...input.output
    }),
    projection: {
      type: "task",
      value: task
    }
  });

  return task;
}

function localAgentTaskOutput(workerResult: CodexDirectWorkerResult): JsonObject {
  return {
    summary: workerResult.summary,
    worker: workerResult.worker,
    model: workerResult.model,
    status: workerResult.status,
    exitCode: workerResult.exitCode,
    toolCalls: workerResult.toolCalls,
    workerRunId: workerResult.workerRun.id,
    ...(workerResult.approval === undefined ? {} : { approval: workerResult.approval })
  };
}

function localAgentWorkerOutput(workerResult: CodexDirectWorkerResult): JsonObject {
  return {
    worker: workerResult.worker,
    model: workerResult.model,
    status: workerResult.status,
    exitCode: workerResult.exitCode,
    toolCalls: workerResult.toolCalls,
    summary: workerResult.summary
  };
}

function localAgentFailureFromError(error: unknown): {
  taskStatus: Task["status"];
  workerStatus: "failed" | "waiting_approval" | "blocked";
  resultStatus: RunLocalAgentTaskResult["status"];
  output: JsonObject;
  approval?: CodexDirectWorkerResult["approval"];
} {
  if (error instanceof ToolActionApprovalRequiredError) {
    const approval = {
      id: error.approval.id,
      actionId: error.approval.actionId,
      policyDecisionId: error.policyDecision.id,
      reason: error.approval.reason
    };

    return {
      taskStatus: "waiting_approval",
      workerStatus: "waiting_approval",
      resultStatus: "waiting_approval",
      output: {
        summary: error.message,
        approval
      },
      approval
    };
  }

  if (error instanceof ToolActionDeniedError) {
    return {
      taskStatus: "blocked",
      workerStatus: "blocked",
      resultStatus: "blocked",
      output: {
        summary: error.message
      }
    };
  }

  return {
    taskStatus: "failed",
    workerStatus: "failed",
    resultStatus: "failed",
    output: {
      summary: error instanceof Error ? error.message : String(error)
    }
  };
}

function localAgentTaskStatus(
  status: CodexDirectWorkerResult["status"]
): Task["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "waiting_approval":
      return "waiting_approval";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
  }
}

function workerStartAction(input: {
  task: Task;
  cwd: string;
  worker: LocalAgentWorkerKind;
}): ActionEnvelope {
  return {
    actionId: stableActionId("worker_native_start", [input.task.id, input.worker]),
    actionType: "worker.native.start",
    resource: {
      type: "process",
      id: input.worker
    },
    context: {
      cwd: input.cwd
    }
  };
}

function localAgentTaskWorker(task: Task): LocalAgentWorkerKind {
  const worker = task.input.worker;

  if (worker === "codex_direct" || worker === "codex_cli" || worker === "claude_code") {
    return worker;
  }

  return "codex_direct";
}

function localAgentTaskMode(task: Task): LocalAgentMode {
  const mode = task.input.mode;

  if (mode === "read-only" || mode === "edit" || mode === "repair") {
    return mode;
  }

  return "read-only";
}

function localAgentTaskModel(task: Task): string | undefined {
  const model = task.input.model;

  return typeof model === "string" && model.trim().length > 0
    ? model.trim()
    : undefined;
}

function localAgentTaskMaxTurns(task: Task): number | undefined {
  const maxTurns = task.input.maxTurns;

  return typeof maxTurns === "number" && Number.isInteger(maxTurns) && maxTurns > 0
    ? maxTurns
    : undefined;
}

function requiredTaskString(task: Task, field: string): string {
  const value = task.input[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Local agent task ${field} is required`);
  }

  return value.trim();
}

function stableActionId(prefix: string, parts: unknown[]): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 12);

  return `act_${prefix.replaceAll(".", "_")}_${hash}`;
}

function localAgentEvent(
  type: string,
  aggregateType: string,
  aggregateId: string,
  createdAt: string,
  payload: RunsteadEvent["payload"]
): RunsteadEvent {
  return {
    eventId: createRunsteadId("evt"),
    type,
    aggregateType,
    aggregateId,
    payload,
    createdAt
  };
}

function localAgentTitle(prompt: string): string {
  const firstLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const title = firstLine ?? "Local agent task";

  return title.length > 80 ? `${title.slice(0, 77)}...` : title;
}

function requireNonEmptyString(value: string, field: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`Local agent ${field} is required`);
  }

  return trimmed;
}
