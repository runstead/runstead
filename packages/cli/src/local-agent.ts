import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

import {
  createRunsteadId,
  type Goal,
  type JsonObject,
  type RunsteadEvent,
  type Task,
  type WorkerRun
} from "@runstead/core";
import {
  appendEventAndProject,
  openRunsteadDatabase,
  type RunsteadDatabase
} from "@runstead/state-sqlite";

import type { CiRepairWorkerKind } from "./ci-repair-orchestrator.js";
import {
  createWorkspaceCheckpoint,
  recordWorkspaceCheckpointCreatedEvent,
  recordWorkspaceCheckpointRestoreEvent,
  restoreWorkspaceCheckpoint,
  type GitCheckpointRunner,
  type RestoreWorkspaceCheckpointResult,
  type WorkspaceCheckpoint
} from "./checkpoints.js";
import {
  CODEX_DIRECT_WORKER_KIND,
  runCodexDirectWorker,
  type CodexDirectTransport,
  type CodexDirectWorkerResult
} from "./codex-direct-worker.js";
import {
  runGovernedToolAction,
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "./governed-action.js";
import { showGoal } from "./goals.js";
import {
  diagnoseLocalAgentRun,
  diagnoseLocalAgentTask,
  formatLocalAgentDiagnostics,
  type LocalAgentRunDiagnosticInput
} from "./local-agent-diagnostics.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import type { ActionEnvelope, PolicyProfile } from "./policy.js";
import { requireRunsteadRoot, requireRunsteadStateDb } from "./runstead-root.js";
import { finishWorkerRun, startWorkerRun } from "./runtime-audit.js";
import { claimTask, showTask } from "./tasks.js";
import {
  runTaskVerifiersUnlocked,
  type RunTaskVerifierCommandResult,
  type RunTaskVerifiersResult
} from "./verifier-runner.js";
import type { CommandVerifierInput } from "./verifier-evidence.js";
import {
  createModelProviderRuntime,
  resolveModelProviderModel
} from "./model-provider-runtime.js";
import {
  startWrappedWorker,
  type WorkerProcessRunner,
  type WrappedWorkerRunResult
} from "./wrapped-worker.js";

export const LOCAL_AGENT_TASK_TYPE = "local_agent_task";

export type LocalAgentMode = "read-only" | "edit" | "repair";
export type LocalAgentWorkerKind = CiRepairWorkerKind;

export interface CreateLocalAgentTaskOptions {
  cwd?: string;
  prompt: string;
  preset?: string;
  title?: string;
  worker?: LocalAgentWorkerKind;
  provider?: string;
  model?: string;
  baseUrl?: string;
  mode?: LocalAgentMode;
  allowedPaths?: string[];
  deniedPaths?: string[];
  verifierCommands?: CommandVerifierInput[];
  maxTurns?: number;
  maxToolCalls?: number;
  maxFailedToolCalls?: number;
  finalizeOnBudget?: boolean;
  gitDiffStaged?: boolean;
  gitDiffBase?: string;
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
  workerRunner?: WorkerProcessRunner;
  now?: Date;
}

export interface UndoLocalAgentTaskOptions {
  cwd?: string;
  taskId: string;
  actor?: string;
  allowHeadMismatch?: boolean;
  runner?: GitCheckpointRunner;
  now?: Date;
}

export interface UndoLocalAgentTaskResult {
  task: Task;
  checkpointId: string;
  restore: RestoreWorkspaceCheckpointResult;
}

export interface RunLocalAgentTaskResult {
  cwd: string;
  task: Task;
  goal: Goal;
  workerResult?: LocalAgentWorkerResult;
  status: "completed" | "waiting_approval" | "blocked" | "failed";
  summary: string;
  audit: LocalAgentAuditSummary;
  checkpoint?: WorkspaceCheckpoint;
  verifierResults?: RunTaskVerifierCommandResult[];
  approval?: CodexDirectWorkerResult["approval"];
}

export type LocalAgentWorkerResult = CodexDirectWorkerResult | WrappedWorkerRunResult;

export interface LocalAgentAuditCount {
  name: string;
  status: string;
  count: number;
}

export interface LocalAgentPolicyDecisionCount {
  decision: string;
  risk: string;
  count: number;
}

export interface LocalAgentAuditSummary {
  workerRuns: LocalAgentAuditCount[];
  toolCalls: LocalAgentAuditCount[];
  policyDecisions: LocalAgentPolicyDecisionCount[];
  approvals: LocalAgentAuditCount[];
}

export interface LocalAgentTaskReport {
  cwd: string;
  task: Task;
  goal: Goal;
  audit: LocalAgentAuditSummary;
  toolCalls: LocalAgentReportToolCall[];
}

export interface LocalAgentReportToolCall {
  id: string;
  actionType: string;
  status: string;
  policyDecisionId?: string;
  resource?: string;
  summary?: string;
}

export async function attachLocalAgentVerifierEvidence(options: {
  cwd?: string;
  taskId: string;
  now?: Date;
}): Promise<RunTaskVerifiersResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const verifierResult = await runTaskVerifiersUnlocked({
    cwd,
    taskId: options.taskId,
    claim: true,
    mode: "evidence_only",
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const currentTask = showTask({ cwd, id: options.taskId }).task;

  if (!isLocalAgentTask(currentTask)) {
    throw new Error(`Task ${options.taskId} is not a local agent task`);
  }

  const prompt = requiredTaskString(currentTask, "prompt");
  const updatedAt = (options.now ?? new Date()).toISOString();
  const task: Task = {
    ...currentTask,
    status: "queued",
    input: {
      ...currentTask.input,
      prompt: `${prompt}\n\n${formatVerifierEvidencePrompt(verifierResult.commandResults)}`,
      verifierEvidence: verifierResult.commandResults.map(verifierEvidenceInput)
    },
    updatedAt
  };
  const database = openRunsteadDatabase(state.stateDb);

  try {
    appendEventAndProject(database, {
      event: localAgentEvent(
        "task.verifier_evidence_attached",
        "task",
        task.id,
        updatedAt,
        {
          previousStatus: currentTask.status,
          verifierEvidence: task.input.verifierEvidence
        }
      ),
      projection: {
        type: "task",
        value: task
      }
    });
  } finally {
    database.close();
  }

  return verifierResult;
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

  const worker = localAgentTaskWorker(claimedTask);

  if (worker !== CODEX_DIRECT_WORKER_KIND && worker !== "codex_cli") {
    throw new Error("Local agent task execution currently supports codex_direct or codex_cli");
  }

  const explicitProvider = localAgentTaskProvider(claimedTask);
  const explicitModel = localAgentTaskModel(claimedTask);
  const explicitBaseUrl = localAgentTaskBaseUrl(claimedTask);
  const runtime =
    worker === CODEX_DIRECT_WORKER_KIND
      ? options.transport === undefined
        ? await createModelProviderRuntime({
            cwd,
            ...(explicitProvider === undefined ? {} : { explicitProvider }),
            ...(explicitModel === undefined ? {} : { explicitModel }),
            ...(explicitBaseUrl === undefined ? {} : { explicitBaseUrl }),
            ...(options.now === undefined ? {} : { now: options.now })
          })
        : await resolveModelProviderModel({
            cwd,
            ...(explicitProvider === undefined ? {} : { explicitProvider }),
            ...(explicitModel === undefined ? {} : { explicitModel }),
            ...(explicitBaseUrl === undefined ? {} : { explicitBaseUrl })
          })
      : undefined;

  const startedAt = (options.now ?? new Date()).toISOString();
  const runningTask: Task = {
    ...claimedTask,
    status: "running",
    attempt:
      claimedTask.attempt + (localAgentShouldIncrementAttempt(claimedTask) ? 1 : 0),
    updatedAt: startedAt
  };
  const goal = showGoal({ cwd, id: runningTask.goalId }).goal;
  const policy = await loadPolicyProfileFromFile(
    join(root.root, "policies", "repo-maintenance.yaml")
  );
  const transport =
    worker === CODEX_DIRECT_WORKER_KIND
      ? (options.transport ??
        (runtime as Awaited<ReturnType<typeof createModelProviderRuntime>>).transport)
      : undefined;
  const database = openRunsteadDatabase(state.stateDb);

  try {
    appendEventAndProject(database, {
      event: localAgentEvent("task.started", "task", runningTask.id, startedAt, {
        previousStatus: claimedTask.status,
        attempt: runningTask.attempt
      }),
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
      worker,
      ...(runtime === undefined
        ? {}
        : {
            model: runtime.model,
            modelProviderResourceId: runtime.modelProviderResourceId,
            modelProviderNetworkDomains: runtime.networkDomains
          }),
      ...(transport === undefined ? {} : { transport }),
      ...(worker === "codex_cli" && explicitModel !== undefined
        ? { model: explicitModel }
        : {}),
      ...(options.workerRunner === undefined ? {} : { workerRunner: options.workerRunner }),
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
  worker: LocalAgentWorkerKind;
  model?: string;
  modelProviderResourceId?: string;
  modelProviderNetworkDomains?: string[];
  transport?: CodexDirectTransport;
  workerRunner?: WorkerProcessRunner;
  now?: Date;
}): Promise<RunLocalAgentTaskResult> {
  const orchestratorRun = startWorkerRun({
    database: options.database,
    task: options.task,
    workerType: "local_agent_orchestrator",
    enforcementLevel: "policy_enforced",
    ...(options.now === undefined ? {} : { now: options.now })
  });
  let checkpoint: WorkspaceCheckpoint | undefined;

  try {
    checkpoint = await createLocalAgentCheckpointIfNeeded({
      ...options,
      workerRun: orchestratorRun
    });
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
        worker: options.worker
      }),
      requestedBy: "runstead:local-agent",
      ...(options.now === undefined ? {} : { now: options.now }),
      run: async () => {
        const value = await runLocalAgentWorker({
          ...options,
          ...(checkpoint === undefined ? {} : { checkpoint })
        });

        return {
          value,
          output: localAgentWorkerOutput({ workerResult: value })
        };
      }
    });
    const workerResult = governed.value;
    const verifierResult =
      localAgentWorkerCompleted(workerResult)
        ? await runLocalAgentVerifiersIfNeeded(options)
        : undefined;
    const finalStatus = localAgentFinalTaskStatus(workerResult, verifierResult);
    const summary = localAgentFinalSummary(workerResult, verifierResult);
    const finalTask = finalizeLocalAgentTask({
      database: options.database,
      task: options.task,
      status: finalStatus,
      output: localAgentTaskOutput({
        workerResult,
        summary,
        ...(checkpoint === undefined ? {} : { checkpoint }),
        ...(verifierResult === undefined ? {} : { verifierResult })
      }),
      ...(options.now === undefined ? {} : { now: options.now })
    });

    finishWorkerRun({
      database: options.database,
      workerRun: orchestratorRun,
      status:
        finalStatus === "completed" ? "completed" : localAgentResultStatus(finalStatus),
      output: localAgentWorkerOutput({
        workerResult,
        summary,
        ...(checkpoint === undefined ? {} : { checkpoint }),
        ...(verifierResult === undefined ? {} : { verifierResult })
      }),
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return {
      cwd: options.cwd,
      task: finalTask,
      goal: options.goal,
      workerResult,
      status: localAgentResultStatus(finalStatus),
      summary,
      audit: summarizeLocalAgentAudit(options.database, finalTask.id),
      ...(checkpoint === undefined ? {} : { checkpoint }),
      ...(verifierResult === undefined
        ? {}
        : { verifierResults: verifierResult.commandResults }),
      ...(!isCodexDirectLocalAgentWorkerResult(workerResult) ||
      workerResult.approval === undefined
        ? {}
        : { approval: workerResult.approval })
    };
  } catch (error) {
    const failure = localAgentFailureFromError(error, checkpoint);
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
      audit: summarizeLocalAgentAudit(options.database, finalTask.id),
      ...(checkpoint === undefined ? {} : { checkpoint }),
      ...(failure.approval === undefined ? {} : { approval: failure.approval })
    };
  }
}

async function runLocalAgentWorker(options: {
  cwd: string;
  root: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  goal: Goal;
  task: Task;
  worker: LocalAgentWorkerKind;
  model?: string;
  modelProviderResourceId?: string;
  modelProviderNetworkDomains?: string[];
  transport?: CodexDirectTransport;
  workerRunner?: WorkerProcessRunner;
  checkpoint?: WorkspaceCheckpoint;
  now?: Date;
}): Promise<LocalAgentWorkerResult> {
  if (options.worker === CODEX_DIRECT_WORKER_KIND) {
    const maxTurns = localAgentTaskMaxTurns(options.task);

    if (
      options.model === undefined ||
      options.modelProviderResourceId === undefined ||
      options.modelProviderNetworkDomains === undefined ||
      options.transport === undefined
    ) {
      throw new Error("Codex Direct local agent runtime is incomplete");
    }

    return runCodexDirectWorker({
      cwd: options.cwd,
      stateDb: options.stateDb,
      database: options.database,
      policy: options.policy,
      goal: options.goal,
      task: options.task,
      model: options.model,
      modelProviderResourceId: options.modelProviderResourceId,
      modelProviderNetworkDomains: options.modelProviderNetworkDomains,
      evidenceDir: join(options.root, "evidence"),
      transport: options.transport,
      prompt: buildLocalAgentPrompt(options.task),
      ...(maxTurns === undefined ? {} : { maxTurns }),
      ...localAgentTaskToolBudget(options.task),
      finalizeOnBudget: localAgentTaskFinalizeOnBudget(options.task),
      ...(options.now === undefined ? {} : { now: options.now })
    });
  }

  if (options.worker === "codex_cli") {
    return startWrappedWorker({
      worker: options.worker,
      goal: options.goal,
      task: options.task,
      workspace: options.cwd,
      evidenceDir: join(options.root, "evidence"),
      allowedScope: localAgentAllowedScope(options.task),
      deniedActions: localAgentDeniedActions(options.task),
      verifierContract: verifierCommandsFromLocalAgentTask(options.task).map(
        (command) => `${command.name}: ${command.command}`
      ),
      policySummary: "repo-maintenance policy enforced by Runstead local agent",
      instructions: [buildLocalAgentPrompt(options.task)],
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.checkpoint === undefined
        ? {}
        : { checkpointBefore: options.checkpoint }),
      ...(options.workerRunner === undefined ? {} : { runner: options.workerRunner })
    });
  }

  throw new Error(`Local agent task execution does not support ${options.worker}`);
}

export async function loadLocalAgentTaskReport(options: {
  cwd?: string;
  taskId: string;
}): Promise<LocalAgentTaskReport> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const task = showTask({ cwd, id: options.taskId }).task;

  if (!isLocalAgentTask(task)) {
    throw new Error(`Task ${options.taskId} is not a local agent task`);
  }

  const goal = showGoal({ cwd, id: task.goalId }).goal;
  const database = openRunsteadDatabase(state.stateDb);

  try {
    return {
      cwd,
      task,
      goal,
      audit: summarizeLocalAgentAudit(database, task.id),
      toolCalls: readLocalAgentReportToolCalls(database, task.id)
    };
  } finally {
    database.close();
  }
}

export async function undoLocalAgentTask(
  options: UndoLocalAgentTaskOptions
): Promise<UndoLocalAgentTaskResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const root = await requireRunsteadRoot(cwd);
  const state = await requireRunsteadStateDb(cwd);
  const task = showTask({ cwd, id: options.taskId }).task;

  if (!isLocalAgentTask(task)) {
    throw new Error(`Task ${options.taskId} is not a local agent task`);
  }

  const checkpointId = localAgentTaskCheckpointId(task);

  if (checkpointId === undefined) {
    throw new Error(`Task ${options.taskId} does not have a checkpoint to undo`);
  }

  const restore = await restoreWorkspaceCheckpoint({
    workspace: cwd,
    checkpointDir: join(root.root, "checkpoints"),
    checkpointId,
    allowHeadMismatch: options.allowHeadMismatch === true,
    ...(options.runner === undefined ? {} : { runner: options.runner })
  });

  recordWorkspaceCheckpointRestoreEvent({
    stateDb: state.stateDb,
    result: restore,
    actor: options.actor ?? "local-admin",
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    task,
    checkpointId,
    restore
  };
}

export function formatLocalAgentRunReport(result: RunLocalAgentTaskResult): string {
  return [
    "Runstead agent run",
    `Task: ${result.task.id}`,
    `Status: ${result.status}`,
    ...(result.workerResult === undefined
      ? []
      : formatLocalAgentWorkerResultLines(result.workerResult)),
    ...formatLocalAgentWarnings(
      result.workerResult !== undefined &&
        isCodexDirectLocalAgentWorkerResult(result.workerResult)
        ? result.workerResult.warnings
        : undefined
    ),
    ...(result.checkpoint === undefined ? [] : [`Checkpoint: ${result.checkpoint.id}`]),
    ...(result.verifierResults === undefined
      ? []
      : [
          "Verifiers:",
          ...result.verifierResults.map(
            (command) =>
              `  ${command.verifier}: exit=${command.exitCode ?? "unknown"} evidence=${command.evidenceId}`
          )
        ]),
    ...(result.approval === undefined
      ? []
      : [`Approval: waiting ${result.approval.id}`]),
    ...formatLocalAgentDiagnostics(
      diagnoseLocalAgentRun(localAgentRunDiagnosticsInput(result))
    ),
    `Summary: ${result.summary}`,
    ...formatLocalAgentAuditSummary(result.audit)
  ].join("\n");
}

export function formatLocalAgentUndoReport(result: UndoLocalAgentTaskResult): string {
  return [
    "Runstead agent undo",
    `Task: ${result.task.id}`,
    `Checkpoint: ${result.checkpointId}`,
    `HEAD: ${result.restore.currentHead ?? "unknown"} -> ${result.restore.checkpoint.head ?? "unknown"}`,
    `Tracked patch restored: ${result.restore.restoredTrackedPatch ? "yes" : "no"}`,
    `Untracked files restored: ${result.restore.restoredUntrackedFiles.length}`,
    `Untracked files removed: ${result.restore.removedUntrackedFiles.length}`
  ].join("\n");
}

export function localAgentRunExitCode(result: RunLocalAgentTaskResult): number {
  return result.status === "completed" ? 0 : 1;
}

function formatLocalAgentWorkerResultLines(
  workerResult: LocalAgentWorkerResult
): string[] {
  if (isCodexDirectLocalAgentWorkerResult(workerResult)) {
    return [
      `Worker: ${workerResult.worker}`,
      `Provider: ${workerResult.modelProvider}`,
      `Model: ${workerResult.model}`,
      `Tool calls: ${workerResult.toolCalls}`,
      `Failed tool calls: ${workerResult.failedToolCalls}`
    ];
  }

  return [
    `Worker: ${workerResult.worker}`,
    `Command: ${workerResult.command}`,
    `Mode: wrapped external worker`,
    `Model: ${wrappedWorkerModel(workerResult) ?? "Codex CLI default"}`,
    `Model source: ${wrappedWorkerModel(workerResult) === undefined ? "codex_cli_config" : "runstead_model_option"}`,
    "Tool proxy: none (worker-internal tool calls are not hard-proxied)",
    `Exit: ${workerResult.exitCode}`,
    `Output valid: ${workerResult.outputValidation.valid ? "yes" : "no"}`,
    `Stdout: ${Buffer.byteLength(workerResult.stdout, "utf8")} bytes`,
    `Stderr: ${Buffer.byteLength(workerResult.stderr, "utf8")} bytes`
  ];
}

function localAgentRunDiagnosticsInput(
  result: RunLocalAgentTaskResult
): LocalAgentRunDiagnosticInput {
  if (
    result.workerResult === undefined ||
    !isCodexDirectLocalAgentWorkerResult(result.workerResult)
  ) {
    return {
      task: result.task,
      status: result.status,
      summary: result.summary,
      ...(result.verifierResults === undefined
        ? {}
        : { verifierResults: result.verifierResults }),
      ...(result.approval === undefined ? {} : { approval: result.approval })
    };
  }

  return {
    task: result.task,
    status: result.status,
    summary: result.summary,
    workerResult: {
      status: result.workerResult.status,
      failedToolCalls: result.workerResult.failedToolCalls,
      warnings: result.workerResult.warnings,
      ...(result.workerResult.budget === undefined
        ? {}
        : { budget: result.workerResult.budget })
    },
    ...(result.verifierResults === undefined
      ? {}
      : { verifierResults: result.verifierResults }),
    ...(result.approval === undefined ? {} : { approval: result.approval })
  };
}

export function formatLocalAgentTaskReport(report: LocalAgentTaskReport): string {
  const sections = localAgentReportSections(report);

  return [
    "Runstead agent report",
    `Task: ${report.task.id}`,
    `Goal: ${report.goal.id} ${report.goal.title}`,
    `Status: ${report.task.status}`,
    `Worker: ${localAgentTaskWorker(report.task)}`,
    `Mode: ${localAgentTaskMode(report.task)}`,
    ...(sections.model.provider === undefined
      ? []
      : [`Provider: ${sections.model.provider}`]),
    ...(sections.model.model === undefined ? [] : [`Model: ${sections.model.model}`]),
    ...(sections.model.modelSource === undefined
      ? []
      : [`Model source: ${sections.model.modelSource}`]),
    ...formatWrappedWorkerTaskReportLines(sections),
    ...(sections.checkpoint === undefined
      ? []
      : [`Checkpoint: ${sections.checkpoint}`]),
    ...formatOutputWarnings(report.task),
    ...formatLocalAgentDiagnostics(diagnoseLocalAgentTask(report.task)),
    ...(sections.model.summary === undefined
      ? []
      : ["Model summary:", `  ${sections.model.summary}`]),
    "File/tool activity:",
    ...formatReportToolCalls(sections.fileActivity),
    "Verifier evidence:",
    ...formatReportVerifiers(sections.verifiers),
    "Failed tool calls:",
    ...formatReportToolCalls(sections.failedToolCalls),
    ...formatLocalAgentAuditSummary(report.audit)
  ].join("\n");
}

export function formatLocalAgentTaskReportJson(report: LocalAgentTaskReport): string {
  return `${JSON.stringify(localAgentReportSections(report), null, 2)}\n`;
}

export function formatLocalAgentTaskReportMarkdown(
  report: LocalAgentTaskReport
): string {
  const sections = localAgentReportSections(report);

  return [
    `# Runstead agent report: ${report.task.id}`,
    "",
    `- Status: ${report.task.status}`,
    `- Goal: ${report.goal.id} ${report.goal.title}`,
    `- Worker: ${localAgentTaskWorker(report.task)}`,
    `- Mode: ${localAgentTaskMode(report.task)}`,
    ...(sections.model.provider === undefined
      ? []
      : [`- Provider: ${sections.model.provider}`]),
    ...(sections.model.model === undefined ? [] : [`- Model: ${sections.model.model}`]),
    ...(sections.model.modelSource === undefined
      ? []
      : [`- Model source: ${sections.model.modelSource}`]),
    ...formatWrappedWorkerTaskReportLines(sections).map((line) => `- ${line}`),
    ...(sections.checkpoint === undefined
      ? []
      : [`- Checkpoint: ${sections.checkpoint}`]),
    "",
    "## Model Summary",
    "",
    sections.model.summary ?? "None recorded.",
    "",
    "## File And Tool Activity",
    "",
    ...markdownToolCalls(sections.fileActivity),
    "",
    "## Verifier Evidence",
    "",
    ...markdownVerifiers(sections.verifiers),
    "",
    "## Failed Tool Calls",
    "",
    ...markdownToolCalls(sections.failedToolCalls),
    "",
    "## Policy And Approval",
    "",
    ...formatLocalAgentAuditSummary(report.audit).map((line) => `- ${line.trim()}`)
  ].join("\n");
}

function localAgentReportSections(report: LocalAgentTaskReport) {
  return {
    task: {
      id: report.task.id,
      status: report.task.status,
      goalId: report.goal.id,
      worker: localAgentTaskWorker(report.task),
      mode: localAgentTaskMode(report.task)
    },
    model: {
      provider: stringOutput(report.task.output ?? {}, "modelProvider") || undefined,
      model: stringOutput(report.task.output ?? {}, "model") || undefined,
      modelSource:
        stringOutput(report.task.output ?? {}, "modelSource") || undefined,
      status: stringOutput(report.task.output ?? {}, "status") || undefined,
      summary: stringOutput(report.task.output ?? {}, "summary") || undefined,
      toolCalls: numberOutput(report.task.output ?? {}, "toolCalls"),
      failedToolCalls: numberOutput(report.task.output ?? {}, "failedToolCalls")
    },
    workerRuntime: {
      command: stringOutput(report.task.output ?? {}, "command") || undefined,
      governance: recordOutput(report.task.output ?? {}, "governance"),
      outputValidation: recordOutput(report.task.output ?? {}, "outputValidation"),
      stdoutBytes: numberOutput(report.task.output ?? {}, "stdoutBytes"),
      stderrBytes: numberOutput(report.task.output ?? {}, "stderrBytes")
    },
    fileActivity: report.toolCalls.filter((call) =>
      [
        "worker.native.start",
        "worker.external.start",
        "filesystem.read",
        "filesystem.write",
        "filesystem.patch",
        "git.status",
        "git.diff",
        "git.log",
        "git.show",
        "git.diff.summary",
        "shell.exec",
        "verifier.run",
        "evidence.read",
        "workspace.facts.read"
      ].includes(call.actionType)
    ),
    verifiers: verifierReportRows(report.task.output ?? {}),
    failedToolCalls: report.toolCalls.filter((call) => call.status !== "completed"),
    policy: report.audit.policyDecisions,
    approvals: report.audit.approvals,
    checkpoint: stringOutput(report.task.output ?? {}, "checkpointId") || undefined,
    audit: report.audit
  };
}

function verifierReportRows(output: JsonObject): {
  verifier: string;
  exitCode?: number | string | null;
  timedOut?: boolean;
  evidenceId?: string;
}[] {
  const verifiers = output.verifiers;

  return Array.isArray(verifiers)
    ? verifiers.filter(isVerifierReportRow).map((row) => ({
        verifier: row.verifier,
        ...(row.exitCode === undefined ? {} : { exitCode: row.exitCode }),
        ...(row.timedOut === undefined ? {} : { timedOut: row.timedOut }),
        ...(row.evidenceId === undefined ? {} : { evidenceId: row.evidenceId })
      }))
    : [];
}

function formatReportToolCalls(calls: LocalAgentReportToolCall[]): string[] {
  return calls.length === 0
    ? ["  none"]
    : calls.map(
        (call) =>
          `  ${call.actionType} ${call.status}${call.resource === undefined ? "" : ` ${call.resource}`}`
      );
}

function formatReportVerifiers(
  verifiers: ReturnType<typeof verifierReportRows>
): string[] {
  return verifiers.length === 0
    ? ["  none"]
    : verifiers.map(
        (verifier) =>
          `  ${verifier.verifier}: exit=${verifier.exitCode ?? "unknown"} evidence=${verifier.evidenceId ?? "none"}`
      );
}

function formatWrappedWorkerTaskReportLines(
  sections: ReturnType<typeof localAgentReportSections>
): string[] {
  if (sections.workerRuntime.command === undefined) {
    return [];
  }

  const outputValidation = sections.workerRuntime.outputValidation;
  const governance = sections.workerRuntime.governance;
  const outputValid =
    outputValidation === undefined
      ? "unknown"
      : outputValidation.valid === true
        ? "yes"
        : "no";
  const hardProxy =
    governance === undefined
      ? "unknown"
      : governance.hardProxyToolCalls === true
        ? "yes"
        : "no";

  return [
    "Worker runtime:",
    `  command: ${sections.workerRuntime.command}`,
    `  boundary: process wrapper`,
    `  hard-proxied tool calls: ${hardProxy}`,
    `  output valid: ${outputValid}`,
    `  stdout bytes: ${sections.workerRuntime.stdoutBytes ?? 0}`,
    `  stderr bytes: ${sections.workerRuntime.stderrBytes ?? 0}`
  ];
}

function markdownToolCalls(calls: LocalAgentReportToolCall[]): string[] {
  return calls.length === 0
    ? ["None recorded."]
    : calls.map(
        (call) =>
          `- ${call.actionType} ${call.status}${call.resource === undefined ? "" : ` (${call.resource})`}`
      );
}

function markdownVerifiers(verifiers: ReturnType<typeof verifierReportRows>): string[] {
  return verifiers.length === 0
    ? ["None recorded."]
    : verifiers.map(
        (verifier) =>
          `- ${verifier.verifier}: exit=${verifier.exitCode ?? "unknown"}, evidence=${verifier.evidenceId ?? "none"}`
      );
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
    ...(input.options.preset === undefined ? {} : { preset: input.options.preset }),
    ...(input.options.provider === undefined
      ? {}
      : { provider: input.options.provider }),
    ...(input.options.model === undefined ? {} : { model: input.options.model }),
    ...(input.options.baseUrl === undefined ? {} : { baseUrl: input.options.baseUrl }),
    ...(input.options.allowedPaths === undefined
      ? {}
      : { allowedPaths: input.options.allowedPaths }),
    ...(input.options.deniedPaths === undefined
      ? {}
      : { deniedPaths: input.options.deniedPaths }),
    ...(input.options.verifierCommands === undefined
      ? {}
      : { commands: input.options.verifierCommands }),
    ...(input.options.maxTurns === undefined
      ? {}
      : { maxTurns: input.options.maxTurns }),
    ...(input.options.maxToolCalls === undefined
      ? {}
      : { maxToolCalls: input.options.maxToolCalls }),
    ...(input.options.maxFailedToolCalls === undefined
      ? {}
      : { maxFailedToolCalls: input.options.maxFailedToolCalls }),
    ...(input.options.finalizeOnBudget === undefined
      ? {}
      : { finalizeOnBudget: input.options.finalizeOnBudget }),
    ...(input.options.gitDiffStaged === undefined
      ? {}
      : { gitDiffStaged: input.options.gitDiffStaged }),
    ...(input.options.gitDiffBase === undefined
      ? {}
      : { gitDiffBase: input.options.gitDiffBase }),
    ...(input.options.checkpoint === undefined
      ? {}
      : { checkpoint: input.options.checkpoint }),
    ...(input.options.commit === undefined ? {} : { commit: input.options.commit })
  };
}

function buildLocalAgentPrompt(task: Task): string {
  const prompt = requiredTaskString(task, "prompt");
  const mode = localAgentTaskMode(task);

  return [
    prompt,
    "",
    "Runstead local-agent mode:",
    `- mode: ${mode}`,
    ...localAgentModePromptRules(task),
    "- End with a concise summary of what you inspected and any risks or next steps."
  ].join("\n");
}

function localAgentModePromptRules(task: Task): string[] {
  const mode = localAgentTaskMode(task);
  const allowedPaths = localAgentTaskStringArray(task, "allowedPaths");
  const deniedPaths = localAgentTaskStringArray(task, "deniedPaths");
  const pathRules = [
    ...(allowedPaths.length === 0
      ? []
      : [`- Stay within allowed paths: ${allowedPaths.join(", ")}`]),
    ...(deniedPaths.length === 0
      ? []
      : [`- Do not change denied paths: ${deniedPaths.join(", ")}`])
  ];

  if (mode === "read-only") {
    return [
      "- Read-only mode must not call write_file or run_command.",
      "- Use git_status, git_diff, and read_file when useful.",
      ...pathRules
    ];
  }

  return [
    "- Edit and repair modes should prefer apply_patch for scoped workspace changes; use write_file only for generated whole-file contents.",
    "- Runstead creates the pre-edit checkpoint and runs configured verifiers after your model turn.",
    "- Avoid run_command unless the prompt explicitly requests command execution.",
    ...pathRules
  ];
}

function localAgentAllowedScope(task: Task): string[] {
  const allowedPaths = localAgentTaskStringArray(task, "allowedPaths");

  if (allowedPaths.length > 0) {
    return allowedPaths;
  }

  return localAgentTaskMode(task) === "read-only"
    ? ["read-only workspace inspection"]
    : ["repository working tree"];
}

function localAgentDeniedActions(task: Task): string[] {
  const deniedPaths = localAgentTaskStringArray(task, "deniedPaths");
  const denied = [
    ...(localAgentTaskMode(task) === "read-only"
      ? ["modify files", "run mutating commands"]
      : []),
    ...deniedPaths.map((path) => `modify ${path}`)
  ];

  return denied.length === 0
    ? ["access secrets", "push or publish without approval"]
    : denied;
}

async function createLocalAgentCheckpointIfNeeded(options: {
  cwd: string;
  root: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  task: Task;
  workerRun: WorkerRun;
  now?: Date;
}): Promise<WorkspaceCheckpoint | undefined> {
  if (!localAgentTaskNeedsCheckpoint(options.task)) {
    return undefined;
  }

  const checkpointDir = join(options.root, "checkpoints");
  const governed = await runGovernedToolAction({
    cwd: options.cwd,
    stateDb: options.stateDb,
    database: options.database,
    policy: options.policy,
    task: options.task,
    workerRun: options.workerRun,
    action: checkpointCreateAction({
      task: options.task,
      cwd: options.cwd,
      checkpointDir
    }),
    requestedBy: "runstead:local-agent",
    ...(options.now === undefined ? {} : { now: options.now }),
    run: async () => {
      const value = await createWorkspaceCheckpoint({
        workspace: options.cwd,
        checkpointDir,
        ...(options.now === undefined ? {} : { now: options.now })
      });
      recordWorkspaceCheckpointCreatedEvent({
        stateDb: options.stateDb,
        checkpoint: value,
        actor: "runstead:local-agent",
        ...(options.now === undefined ? {} : { now: options.now })
      });

      return {
        value,
        output: checkpointOutput(value)
      };
    }
  });

  return governed.value;
}

async function runLocalAgentVerifiersIfNeeded(options: {
  cwd: string;
  task: Task;
  now?: Date;
}): Promise<RunTaskVerifiersResult | undefined> {
  if (
    localAgentTaskMode(options.task) === "read-only" ||
    verifierCommandsFromLocalAgentTask(options.task).length === 0
  ) {
    return undefined;
  }

  return runTaskVerifiersUnlocked({
    cwd: options.cwd,
    taskId: options.task.id,
    claim: false,
    mode: "evidence_only",
    ...(options.now === undefined ? {} : { now: options.now })
  });
}

function localAgentFinalTaskStatus(
  workerResult: LocalAgentWorkerResult,
  verifierResult?: RunTaskVerifiersResult
): Task["status"] {
  if (isCodexDirectLocalAgentWorkerResult(workerResult)) {
    if (workerResult.status !== "completed") {
      return localAgentTaskStatus(workerResult.status);
    }

    return verifierResult?.task.status ?? "completed";
  }

  if (workerResult.exitCode !== 0) {
    return "failed";
  }

  return verifierResult?.task.status ?? "completed";
}

function localAgentResultStatus(
  status: Task["status"]
): RunLocalAgentTaskResult["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "waiting_approval":
      return "waiting_approval";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    default:
      return "failed";
  }
}

function localAgentFinalSummary(
  workerResult: LocalAgentWorkerResult,
  verifierResult?: RunTaskVerifiersResult
): string {
  if (!isCodexDirectLocalAgentWorkerResult(workerResult)) {
    const summary =
      workerResult.structuredOutput?.summary ??
      (workerResult.stderr.length === 0
        ? `Wrapped worker exited ${workerResult.exitCode}`
        : workerResult.stderr.trim());

    if (verifierResult === undefined) {
      return summary;
    }

    const verifierSummary = verifierResult.task.output?.summary;

    return typeof verifierSummary === "string" && verifierSummary.length > 0
      ? `${summary} Verifiers: ${verifierSummary}`
      : summary;
  }

  if (verifierResult === undefined) {
    return workerResult.summary;
  }

  const verifierSummary = verifierResult.task.output?.summary;

  return typeof verifierSummary === "string" && verifierSummary.length > 0
    ? `${workerResult.summary} Verifiers: ${verifierSummary}`
    : workerResult.summary;
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

function localAgentTaskOutput(input: {
  workerResult: LocalAgentWorkerResult;
  summary: string;
  checkpoint?: WorkspaceCheckpoint;
  verifierResult?: RunTaskVerifiersResult;
}): JsonObject {
  if (!isCodexDirectLocalAgentWorkerResult(input.workerResult)) {
    return {
      summary: input.summary,
      worker: input.workerResult.worker,
      status: input.workerResult.exitCode === 0 ? "completed" : "failed",
      exitCode: input.workerResult.exitCode,
      command: input.workerResult.command,
      args: redactedLocalWrappedWorkerArgs(input.workerResult),
      governance: localWrappedWorkerGovernanceOutput(input.workerResult),
      outputValidation: input.workerResult.outputValidation,
      stdoutBytes: Buffer.byteLength(input.workerResult.stdout, "utf8"),
      stderrBytes: Buffer.byteLength(input.workerResult.stderr, "utf8"),
      stdoutOmitted: input.workerResult.stdout.length > 0,
      stderrOmitted: input.workerResult.stderr.length > 0,
      ...(wrappedWorkerModel(input.workerResult) === undefined
        ? { modelSource: "codex_cli_config" }
        : {
            model: wrappedWorkerModel(input.workerResult),
            modelSource: "runstead_model_option"
          }),
      ...(input.checkpoint === undefined ? {} : { checkpointId: input.checkpoint.id }),
      ...(input.verifierResult === undefined
        ? {}
        : {
            verifiers: input.verifierResult.commandResults,
            verifierStatus: input.verifierResult.task.status
          })
    };
  }

  return {
    summary: input.summary,
    worker: input.workerResult.worker,
    model: input.workerResult.model,
    modelProvider: input.workerResult.modelProvider,
    status: input.workerResult.status,
    exitCode: input.workerResult.exitCode,
    toolCalls: input.workerResult.toolCalls,
    failedToolCalls: input.workerResult.failedToolCalls,
    workerRunId: input.workerResult.workerRun.id,
    ...(input.workerResult.warnings.length === 0
      ? {}
      : { warnings: input.workerResult.warnings }),
    ...(input.workerResult.budget === undefined
      ? {}
      : { budget: input.workerResult.budget }),
    ...(input.checkpoint === undefined ? {} : { checkpointId: input.checkpoint.id }),
    ...(input.verifierResult === undefined
      ? {}
      : {
          verifiers: input.verifierResult.commandResults,
          verifierStatus: input.verifierResult.task.status
        }),
    ...(input.workerResult.approval === undefined
      ? {}
      : { approval: input.workerResult.approval })
  };
}

function localAgentWorkerOutput(input: {
  workerResult: LocalAgentWorkerResult;
  summary?: string;
  checkpoint?: WorkspaceCheckpoint;
  verifierResult?: RunTaskVerifiersResult;
}): JsonObject {
  if (!isCodexDirectLocalAgentWorkerResult(input.workerResult)) {
    return {
      worker: input.workerResult.worker,
      command: input.workerResult.command,
      args: redactedLocalWrappedWorkerArgs(input.workerResult),
      governance: localWrappedWorkerGovernanceOutput(input.workerResult),
      status: input.workerResult.exitCode === 0 ? "completed" : "failed",
      exitCode: input.workerResult.exitCode,
      outputValidation: input.workerResult.outputValidation,
      stdoutBytes: Buffer.byteLength(input.workerResult.stdout, "utf8"),
      stderrBytes: Buffer.byteLength(input.workerResult.stderr, "utf8"),
      stdoutOmitted: input.workerResult.stdout.length > 0,
      stderrOmitted: input.workerResult.stderr.length > 0,
      ...(input.summary === undefined ? {} : { summary: input.summary }),
      ...(wrappedWorkerModel(input.workerResult) === undefined
        ? { modelSource: "codex_cli_config" }
        : {
            model: wrappedWorkerModel(input.workerResult),
            modelSource: "runstead_model_option"
          }),
      ...(input.checkpoint === undefined ? {} : { checkpointId: input.checkpoint.id }),
      ...(input.verifierResult === undefined
        ? {}
        : {
            verifiers: input.verifierResult.commandResults,
            verifierStatus: input.verifierResult.task.status
          })
    };
  }

  return {
    worker: input.workerResult.worker,
    model: input.workerResult.model,
    modelProvider: input.workerResult.modelProvider,
    status: input.workerResult.status,
    exitCode: input.workerResult.exitCode,
    toolCalls: input.workerResult.toolCalls,
    failedToolCalls: input.workerResult.failedToolCalls,
    summary: input.summary ?? input.workerResult.summary,
    ...(input.workerResult.warnings.length === 0
      ? {}
      : { warnings: input.workerResult.warnings }),
    ...(input.workerResult.budget === undefined
      ? {}
      : { budget: input.workerResult.budget }),
    ...(input.checkpoint === undefined ? {} : { checkpointId: input.checkpoint.id }),
    ...(input.verifierResult === undefined
      ? {}
      : {
          verifiers: input.verifierResult.commandResults,
          verifierStatus: input.verifierResult.task.status
        })
  };
}

function summarizeLocalAgentAudit(
  database: RunsteadDatabase,
  taskId: string
): LocalAgentAuditSummary {
  const workerRuns = readAuditCounts(
    database,
    `
      SELECT worker_type AS name, status, COUNT(*) AS count
      FROM worker_runs
      WHERE task_id = ?
      GROUP BY worker_type, status
      ORDER BY worker_type, status
    `,
    taskId
  );
  const toolCalls = readAuditCounts(
    database,
    `
      SELECT action_type AS name, status, COUNT(*) AS count
      FROM tool_calls
      WHERE task_id = ?
      GROUP BY action_type, status
      ORDER BY action_type, status
    `,
    taskId
  );
  const policyDecisions = readPolicyDecisionCounts(
    database,
    `
      SELECT pd.decision, pd.risk, COUNT(*) AS count
      FROM policy_decisions pd
      JOIN tool_calls tc ON tc.policy_decision_id = pd.id
      WHERE tc.task_id = ?
      GROUP BY pd.decision, pd.risk
      ORDER BY pd.decision, pd.risk
    `,
    taskId
  );
  const approvals = readAuditCounts(
    database,
    `
      SELECT a.status AS name, a.risk AS status, COUNT(*) AS count
      FROM approvals a
      JOIN policy_decisions pd ON pd.id = a.policy_decision_id
      JOIN tool_calls tc ON tc.policy_decision_id = pd.id
      WHERE tc.task_id = ?
      GROUP BY a.status, a.risk
      ORDER BY a.status, a.risk
    `,
    taskId
  );

  return {
    workerRuns,
    toolCalls,
    policyDecisions,
    approvals
  };
}

function readLocalAgentReportToolCalls(
  database: RunsteadDatabase,
  taskId: string
): LocalAgentReportToolCall[] {
  return (
    database
      .prepare(
        `
          SELECT id, action_type, status, policy_decision_id, input_json, output_json
          FROM tool_calls
          WHERE task_id = ?
          ORDER BY started_at, id
        `
      )
      .all(taskId) as unknown[]
  ).map((row) => {
    const record = row as Record<string, unknown>;
    const input = parseJsonObject(record.input_json);
    const output = parseJsonObject(record.output_json);

    return {
      id: String(record.id),
      actionType: String(record.action_type),
      status: String(record.status),
      ...(typeof record.policy_decision_id === "string"
        ? { policyDecisionId: record.policy_decision_id }
        : {}),
      ...toolCallResource(input),
      ...toolCallSummary(output)
    };
  });
}

function readAuditCounts(
  database: RunsteadDatabase,
  sql: string,
  taskId: string
): LocalAgentAuditCount[] {
  return (database.prepare(sql).all(taskId) as unknown[]).map((row) => {
    const record = row as Record<string, unknown>;

    return {
      name: String(record.name),
      status: String(record.status),
      count: Number(record.count)
    };
  });
}

function readPolicyDecisionCounts(
  database: RunsteadDatabase,
  sql: string,
  taskId: string
): LocalAgentPolicyDecisionCount[] {
  return (database.prepare(sql).all(taskId) as unknown[]).map((row) => {
    const record = row as Record<string, unknown>;

    return {
      decision: String(record.decision),
      risk: String(record.risk),
      count: Number(record.count)
    };
  });
}

function formatLocalAgentAuditSummary(audit: LocalAgentAuditSummary): string[] {
  return [
    "Audit:",
    ...formatAuditCountGroup("  worker_runs", audit.workerRuns),
    ...formatAuditCountGroup("  tool_calls", audit.toolCalls),
    ...formatPolicyDecisionCounts(audit.policyDecisions),
    ...formatAuditCountGroup("  approvals", audit.approvals)
  ];
}

function formatAuditCountGroup(label: string, rows: LocalAgentAuditCount[]): string[] {
  return rows.length === 0
    ? [`${label}: none`]
    : rows.map((row) => `${label}: ${row.name} ${row.status} x${row.count}`);
}

function formatPolicyDecisionCounts(rows: LocalAgentPolicyDecisionCount[]): string[] {
  return rows.length === 0
    ? ["  policy_decisions: none"]
    : rows.map(
        (row) => `  policy_decisions: ${row.decision} ${row.risk} x${row.count}`
      );
}

function formatOutputWarnings(task: Task): string[] {
  const warnings = task.output?.warnings;

  return Array.isArray(warnings)
    ? formatLocalAgentWarnings(
        warnings.filter((warning): warning is string => typeof warning === "string")
      )
    : [];
}

function formatLocalAgentWarnings(warnings: string[] | undefined): string[] {
  return warnings === undefined || warnings.length === 0
    ? []
    : ["Warnings:", ...warnings.map((warning) => `  ${warning}`)];
}

function localAgentFailureFromError(
  error: unknown,
  checkpoint?: WorkspaceCheckpoint
): {
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
        ...(checkpoint === undefined ? {} : { checkpointId: checkpoint.id }),
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
        summary: error.message,
        ...(checkpoint === undefined ? {} : { checkpointId: checkpoint.id })
      }
    };
  }

  return {
    taskStatus: "failed",
    workerStatus: "failed",
    resultStatus: "failed",
    output: {
      summary: error instanceof Error ? error.message : String(error),
      ...(checkpoint === undefined ? {} : { checkpointId: checkpoint.id })
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

function isCodexDirectLocalAgentWorkerResult(
  workerResult: LocalAgentWorkerResult
): workerResult is CodexDirectWorkerResult {
  return workerResult.worker === CODEX_DIRECT_WORKER_KIND;
}

function localAgentWorkerCompleted(workerResult: LocalAgentWorkerResult): boolean {
  return isCodexDirectLocalAgentWorkerResult(workerResult)
    ? workerResult.status === "completed"
    : workerResult.exitCode === 0;
}

function redactedLocalWrappedWorkerArgs(workerResult: WrappedWorkerRunResult): string[] {
  const omitted = "[omitted from Runstead durable state]";

  return workerResult.args.map((arg) => (arg === workerResult.prompt ? omitted : arg));
}

function wrappedWorkerModel(workerResult: WrappedWorkerRunResult): string | undefined {
  const modelFlagIndex = workerResult.args.indexOf("--model");
  const model =
    modelFlagIndex === -1 ? undefined : workerResult.args[modelFlagIndex + 1];

  return typeof model === "string" && model.trim().length > 0
    ? model.trim()
    : undefined;
}

function localWrappedWorkerGovernanceOutput(
  workerResult: WrappedWorkerRunResult
): JsonObject {
  return {
    enforcement: workerResult.governance.enforcement,
    boundary: "process_wrapper",
    hardProxyToolCalls: workerResult.governance.capabilities.hardProxyToolCalls,
    internalToolProxy: workerResult.governance.internalToolProxy.mode,
    workspaceCheckpoint: workerResult.governance.capabilities.workspaceCheckpoint,
    postRunDiffVerification:
      workerResult.governance.capabilities.postRunDiffVerification
  };
}

function workerStartAction(input: {
  task: Task;
  cwd: string;
  worker: LocalAgentWorkerKind;
}): ActionEnvelope {
  const nativeWorker = input.worker === CODEX_DIRECT_WORKER_KIND;

  return {
    actionId: stableActionId(
      nativeWorker ? "worker_native_start" : "worker_external_start",
      [input.task.id, input.worker]
    ),
    actionType: nativeWorker ? "worker.native.start" : "worker.external.start",
    resource: {
      type: "process",
      id: input.worker
    },
    context: {
      cwd: input.cwd
    }
  };
}

function checkpointCreateAction(input: {
  task: Task;
  cwd: string;
  checkpointDir: string;
}): ActionEnvelope {
  return {
    actionId: stableActionId("checkpoint_create", [
      input.task.id,
      input.cwd,
      input.checkpointDir
    ]),
    actionType: "checkpoint.create",
    resource: {
      type: "repository",
      id: input.cwd
    },
    context: {
      cwd: input.cwd
    }
  };
}

function checkpointOutput(checkpoint: WorkspaceCheckpoint): JsonObject {
  return {
    checkpointId: checkpoint.id,
    head: checkpoint.head ?? "",
    untrackedFiles: checkpoint.untrackedFiles
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

function localAgentTaskNeedsCheckpoint(task: Task): boolean {
  return localAgentTaskMode(task) !== "read-only" && task.input.checkpoint !== false;
}

function localAgentShouldIncrementAttempt(task: Task): boolean {
  const approval = task.output?.approval;

  return !isRecord(approval) || approval.status !== "approved";
}

function localAgentTaskModel(task: Task): string | undefined {
  const model = task.input.model;

  return typeof model === "string" && model.trim().length > 0
    ? model.trim()
    : undefined;
}

function localAgentTaskProvider(task: Task): string | undefined {
  const provider = task.input.provider;

  return typeof provider === "string" && provider.trim().length > 0
    ? provider.trim()
    : undefined;
}

function localAgentTaskBaseUrl(task: Task): string | undefined {
  const baseUrl = task.input.baseUrl;

  return typeof baseUrl === "string" && baseUrl.trim().length > 0
    ? baseUrl.trim()
    : undefined;
}

function localAgentTaskCheckpointId(task: Task): string | undefined {
  const checkpointId = task.output?.checkpointId;

  return typeof checkpointId === "string" && checkpointId.trim().length > 0
    ? checkpointId.trim()
    : undefined;
}

function localAgentTaskStringArray(task: Task, field: string): string[] {
  const value = task.input[field];

  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function localAgentTaskMaxTurns(task: Task): number | undefined {
  const maxTurns = task.input.maxTurns;

  return typeof maxTurns === "number" && Number.isInteger(maxTurns) && maxTurns > 0
    ? maxTurns
    : undefined;
}

function localAgentTaskToolBudget(task: Task): {
  maxToolCalls?: number;
  maxFailedToolCalls?: number;
} {
  return {
    ...positiveIntegerInput(task, "maxToolCalls"),
    ...positiveIntegerInput(task, "maxFailedToolCalls")
  };
}

function localAgentTaskFinalizeOnBudget(task: Task): boolean {
  const value = task.input.finalizeOnBudget;

  return typeof value === "boolean" ? value : localAgentTaskMode(task) === "read-only";
}

function positiveIntegerInput(task: Task, field: string): Record<string, number> {
  const value = task.input[field];

  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? { [field]: value }
    : {};
}

function verifierCommandsFromLocalAgentTask(task: Task): CommandVerifierInput[] {
  const commands = task.input.commands;

  if (!Array.isArray(commands)) {
    return [];
  }

  return commands.flatMap((command): CommandVerifierInput[] => {
    if (!isRecord(command)) {
      return [];
    }

    const name = command.name;
    const commandText = command.command;

    return typeof name === "string" && typeof commandText === "string"
      ? [
          {
            name,
            command: commandText
          }
        ]
      : [];
  });
}

function formatVerifierEvidencePrompt(results: RunTaskVerifierCommandResult[]): string {
  return [
    "Runstead verifier evidence:",
    ...(results.length === 0
      ? ["- none"]
      : results.map(
          (result) =>
            `- ${result.verifier}: exit=${result.exitCode ?? "unknown"} timedOut=${String(result.timedOut)} evidence=${result.evidenceId}`
        )),
    "Use this verifier evidence as the primary test context. Do not rerun tests unless explicitly requested."
  ].join("\n");
}

function verifierEvidenceInput(result: RunTaskVerifierCommandResult): JsonObject {
  return {
    verifier: result.verifier,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    forceKilled: result.forceKilled,
    evidenceId: result.evidenceId,
    ...(result.policyDecisionId === undefined
      ? {}
      : { policyDecisionId: result.policyDecisionId }),
    ...(result.approvalId === undefined ? {} : { approvalId: result.approvalId })
  };
}

function requiredTaskString(task: Task, field: string): string {
  const value = task.input[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Local agent task ${field} is required`);
  }

  return value.trim();
}

function stringOutput(output: JsonObject, key: string): string {
  const value = output[key];

  return typeof value === "string" ? value : "";
}

function numberOutput(output: JsonObject, key: string): number | undefined {
  const value = output[key];

  return typeof value === "number" ? value : undefined;
}

function recordOutput(output: JsonObject, key: string): JsonObject | undefined {
  const value = output[key];

  return isRecord(value) ? value : undefined;
}

function parseJsonObject(value: unknown): JsonObject {
  if (typeof value !== "string" || value.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toolCallResource(
  input: JsonObject
): Pick<LocalAgentReportToolCall, "resource"> {
  const action = input.action;

  if (!isRecord(action) || !isRecord(action.resource)) {
    return {};
  }

  const path = action.resource.path;
  const id = action.resource.id;
  const type = action.resource.type;
  const value =
    typeof path === "string"
      ? path
      : typeof id === "string"
        ? id
        : typeof type === "string"
          ? type
          : undefined;

  return value === undefined ? {} : { resource: value };
}

function toolCallSummary(input: JsonObject): Pick<LocalAgentReportToolCall, "summary"> {
  const summary = input.summary;

  return typeof summary === "string" && summary.length > 0 ? { summary } : {};
}

function isVerifierReportRow(value: unknown): value is {
  verifier: string;
  exitCode?: number | string | null;
  timedOut?: boolean;
  evidenceId?: string;
} {
  return isRecord(value) && typeof value.verifier === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
