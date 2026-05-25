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
  runtimeExecutionSemantics,
  runtimeFinalTaskStatus,
  runtimeTaskResultStatus,
  runtimeWorkerRunStatusFromTaskStatus,
  type RuntimeExecutionSemantics,
  type RuntimeVerifierOutcome,
  type RuntimeWorkerOutcome
} from "@runstead/runtime";
import {
  appendEventAndProject,
  openRunsteadDatabase,
  type RunsteadDatabase
} from "@runstead/state-sqlite";

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
  readApprovedCodexDirectPendingPatch,
  runCodexDirectPendingPatchResume,
  runCodexDirectWorker,
  type CodexDirectTransport,
  type CodexDirectPendingPatchResume,
  type CodexDirectWorkerResult
} from "./codex-direct-worker.js";
import { showApproval } from "./approvals.js";
import {
  runGovernedToolAction,
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "./governed-action.js";
import { showGoal } from "./goals.js";
import {
  diagnoseLocalAgentRun,
  formatLocalAgentDiagnostics,
  type LocalAgentRunDiagnosticInput
} from "./local-agent-diagnostics.js";
import {
  localAgentShouldIncrementAttempt,
  localAgentTaskBaseUrl,
  localAgentTaskCheckpointId,
  localAgentTaskFinalizeOnBudget,
  localAgentTaskMaxTurns,
  localAgentTaskMode,
  localAgentTaskModel,
  localAgentTaskModelRequestTiming,
  localAgentTaskNeedsCheckpoint,
  localAgentTaskProvider,
  localAgentTaskToolBudget,
  localAgentTaskWorker,
  verifierCommandsFromLocalAgentTask,
  type LocalAgentMode,
  type LocalAgentWorkerKind
} from "./local-agent-task-input.js";
import {
  formatLocalAgentAuditSummary,
  formatLocalAgentWarnings,
  summarizeLocalAgentAudit,
  type LocalAgentAuditSummary
} from "./local-agent-report.js";
import {
  buildLocalAgentPrompt,
  formatVerifierEvidencePrompt,
  localAgentAllowedScope,
  localAgentApprovalRequired,
  localAgentDeniedActions,
  localAgentTaskInput,
  requiredTaskString,
  verifierEvidenceInput
} from "./local-agent-prompt.js";
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
  type WorkerProcessProgress,
  type WrappedWorkerRunResult
} from "./wrapped-worker.js";
import type { StartupScaffoldProfile } from "./startup-scaffold-profile.js";

export const LOCAL_AGENT_TASK_TYPE = "local_agent_task";

export type { LocalAgentMode, LocalAgentWorkerKind } from "./local-agent-task-input.js";
export {
  formatLocalAgentTaskReport,
  formatLocalAgentTaskReportJson,
  formatLocalAgentTaskReportMarkdown,
  loadLocalAgentTaskReport
} from "./local-agent-report.js";
export type {
  LocalAgentAuditCount,
  LocalAgentPolicyDecisionCount,
  LocalAgentTaskReport,
  LocalAgentReportToolCall,
  LocalAgentToolFailureKind
} from "./local-agent-report.js";

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
  approvalRequired?: string[];
  verifierCommands?: CommandVerifierInput[];
  maxTurns?: number;
  maxToolCalls?: number;
  maxFailedToolCalls?: number;
  modelRequestTimeoutMs?: number;
  modelRequestHeartbeatMs?: number;
  finalizeOnBudget?: boolean;
  scaffoldProfile?: StartupScaffoldProfile;
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
  workerProgressIntervalMs?: number;
  onWorkerProgress?: (progress: WorkerProcessProgress) => void;
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
  status:
    | "completed"
    | "completed_with_warnings"
    | "waiting_approval"
    | "interrupted"
    | "blocked"
    | "failed";
  summary: string;
  execution: RuntimeExecutionSemantics;
  audit: LocalAgentAuditSummary;
  checkpoint?: WorkspaceCheckpoint;
  verifierResults?: RunTaskVerifierCommandResult[];
  approval?: CodexDirectWorkerResult["approval"];
}

export type LocalAgentWorkerResult = CodexDirectWorkerResult | WrappedWorkerRunResult;

export interface LocalAgentWorkerGovernanceProfile {
  level: "level_1_wrapper" | "level_2_native_proxy";
  enforcement?: string;
  boundary: "process_wrapper" | "native_tool_proxy";
  hardProxyToolCalls: boolean;
  internalToolProxy: "none" | "runstead_governed_actions";
  policyEnforcement: "launch_gate" | "per_tool_call";
  workspaceCheckpoint?: boolean;
  postRunDiffVerification?: boolean;
  auditedActions: string[];
  limitations: string[];
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

  if (
    worker !== CODEX_DIRECT_WORKER_KIND &&
    worker !== "codex_cli" &&
    worker !== "claude_code"
  ) {
    throw new Error(
      "Local agent task execution currently supports codex_direct, codex_cli, or claude_code"
    );
  }

  const explicitProvider = localAgentTaskProvider(claimedTask);
  const explicitModel = localAgentTaskModel(claimedTask);
  const explicitBaseUrl = localAgentTaskBaseUrl(claimedTask);
  const pendingPatchResume =
    worker === CODEX_DIRECT_WORKER_KIND
      ? readLocalAgentApprovedPendingPatch(state.stateDb, claimedTask)
      : undefined;
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
      ...(pendingPatchResume === undefined ? {} : { pendingPatchResume }),
      ...(runtime === undefined
        ? {}
        : {
            model: runtime.model,
            modelProviderResourceId: runtime.modelProviderResourceId,
            modelProviderNetworkDomains: runtime.networkDomains
          }),
      ...(transport === undefined ? {} : { transport }),
      ...(worker !== CODEX_DIRECT_WORKER_KIND && explicitModel !== undefined
        ? { model: explicitModel }
        : {}),
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
  } finally {
    database.close();
  }
}

export interface ResolveLocalAgentResumeTargetResult {
  taskId: string;
  approvalId?: string;
  note?: string;
}

export function resolveLocalAgentResumeTarget(input: {
  cwd?: string;
  targetId: string;
}): ResolveLocalAgentResumeTargetResult {
  if (!input.targetId.startsWith("appr_")) {
    return {
      taskId: input.targetId
    };
  }

  const shown = showApproval({
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    id: input.targetId
  });

  if (shown.task === undefined) {
    throw new Error(
      `Approval ${input.targetId} is not associated with a local agent task`
    );
  }

  if (shown.approval.status === "pending") {
    throw new Error(
      `Approval ${input.targetId} is pending; run: runstead approval approve-and-resume ${input.targetId}`
    );
  }

  if (shown.approval.status !== "approved") {
    throw new Error(
      `Approval ${input.targetId} is ${shown.approval.status}; only approved approvals can be resumed`
    );
  }

  return {
    taskId: shown.task.id,
    approvalId: input.targetId,
    note: `Resolved approval ${input.targetId} to local agent task ${shown.task.id}.`
  };
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
  workerProgressIntervalMs?: number;
  onWorkerProgress?: (progress: WorkerProcessProgress) => void;
  pendingPatchResume?: CodexDirectPendingPatchResume;
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
    const verifierResult = localAgentWorkerCompleted(workerResult)
      ? await runLocalAgentVerifiersIfNeeded(options)
      : undefined;
    const finalStatus = localAgentFinalTaskStatus(workerResult, verifierResult);
    const resultStatus = localAgentResultStatus(finalStatus, workerResult);
    const summary = localAgentFinalSummary(workerResult, verifierResult);
    const execution = localAgentExecutionSemantics({
      workerResult,
      ...(verifierResult === undefined ? {} : { verifierResult })
    });
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
      status: localAgentWorkerRunStatus(finalStatus),
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
      status: resultStatus,
      summary,
      execution,
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
      execution: failure.execution,
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
  workerProgressIntervalMs?: number;
  onWorkerProgress?: (progress: WorkerProcessProgress) => void;
  checkpoint?: WorkspaceCheckpoint;
  pendingPatchResume?: CodexDirectPendingPatchResume;
  now?: Date;
}): Promise<LocalAgentWorkerResult> {
  if (options.worker === CODEX_DIRECT_WORKER_KIND) {
    const maxTurns = localAgentTaskMaxTurns(options.task);

    if (options.pendingPatchResume !== undefined) {
      return runCodexDirectPendingPatchResume({
        cwd: options.cwd,
        stateDb: options.stateDb,
        database: options.database,
        policy: options.policy,
        goal: options.goal,
        task: options.task,
        model: options.model ?? localAgentTaskModel(options.task) ?? "codex_direct",
        ...(options.modelProviderResourceId === undefined
          ? {}
          : { modelProviderResourceId: options.modelProviderResourceId }),
        ...(options.modelProviderNetworkDomains === undefined
          ? {}
          : { modelProviderNetworkDomains: options.modelProviderNetworkDomains }),
        evidenceDir: join(options.root, "evidence"),
        ...(options.transport === undefined ? {} : { transport: options.transport }),
        pendingPatch: options.pendingPatchResume,
        ...(maxTurns === undefined ? {} : { maxTurns }),
        ...localAgentTaskToolBudget(options.task),
        ...localAgentTaskModelRequestTiming(options.task),
        finalizeOnBudget: localAgentTaskFinalizeOnBudget(options.task),
        ...(options.now === undefined ? {} : { now: options.now })
      });
    }

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
      ...localAgentTaskModelRequestTiming(options.task),
      finalizeOnBudget: localAgentTaskFinalizeOnBudget(options.task),
      ...(options.now === undefined ? {} : { now: options.now })
    });
  }

  if (options.worker === "codex_cli" || options.worker === "claude_code") {
    return startWrappedWorker({
      worker: options.worker,
      goal: options.goal,
      task: options.task,
      workspace: options.cwd,
      evidenceDir: join(options.root, "evidence"),
      workerRuntimeDir: join(options.root, "worker-profiles"),
      allowedScope: localAgentAllowedScope(options.task),
      deniedActions: localAgentDeniedActions(options.task),
      approvalRequired: localAgentApprovalRequired(options.task),
      verifierContract: verifierCommandsFromLocalAgentTask(options.task).map(
        (command) => `${command.name}: ${command.command}`
      ),
      policySummary: "repo-maintenance policy enforced by Runstead local agent",
      instructions: [buildLocalAgentPrompt(options.task)],
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.checkpoint === undefined
        ? {}
        : { checkpointBefore: options.checkpoint }),
      ...(options.workerRunner === undefined ? {} : { runner: options.workerRunner }),
      ...(options.workerProgressIntervalMs === undefined
        ? {}
        : { progressIntervalMs: options.workerProgressIntervalMs }),
      ...(options.onWorkerProgress === undefined
        ? {}
        : { onProgress: options.onWorkerProgress })
    });
  }

  throw new Error("Local agent task execution reached an unsupported worker");
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
    ...formatExecutionSemanticsLines(result.execution),
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
  return result.status === "completed" || result.status === "completed_with_warnings"
    ? 0
    : 1;
}

function formatLocalAgentWorkerResultLines(
  workerResult: LocalAgentWorkerResult
): string[] {
  if (isCodexDirectLocalAgentWorkerResult(workerResult)) {
    const governance = localNativeWorkerGovernanceOutput();

    return [
      `Worker: ${workerResult.worker}`,
      `Provider: ${workerResult.modelProvider}`,
      `Model: ${workerResult.model}`,
      `Worker status: ${workerResult.status}`,
      `Governance: ${String(governance.level)}`,
      `Tool proxy: ${String(governance.internalToolProxy)} (${String(governance.policyEnforcement)})`,
      `Tool calls: ${workerResult.toolCalls}`,
      `Failed tool calls: ${workerResult.failedToolCalls}`,
      ...(workerResult.interruption === undefined
        ? []
        : formatCodexDirectInterruptionLines(workerResult.interruption))
    ];
  }

  return [
    `Worker: ${workerResult.worker}`,
    `Command: ${workerResult.command}`,
    `Mode: wrapped external worker`,
    `Model: ${wrappedWorkerModel(workerResult) ?? wrappedWorkerDefaultModelLabel(workerResult)}`,
    `Model source: ${wrappedWorkerModelSource(workerResult)}`,
    `Governance: ${String(localWrappedWorkerGovernanceOutput(workerResult).level)}`,
    "Tool proxy: none (worker-internal tool calls are not hard-proxied)",
    `Exit: ${workerResult.exitCode}`,
    `Output valid: ${workerResult.outputValidation.valid ? "yes" : "no"}`,
    `Stdout: ${Buffer.byteLength(workerResult.stdout, "utf8")} bytes`,
    `Stderr: ${Buffer.byteLength(workerResult.stderr, "utf8")} bytes`
  ];
}

function formatCodexDirectInterruptionLines(
  interruption: NonNullable<CodexDirectWorkerResult["interruption"]>
): string[] {
  if (interruption.reason === "model_timeout") {
    return [
      `Interruption: ${interruption.reason} after ${interruption.timeoutMs}ms`,
      `Retry: ${interruption.retryCommand}`
    ];
  }

  return [
    `Interruption: ${interruption.reason} after ${interruption.attempts} attempts`,
    `Retry: ${interruption.retryCommand}`
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
      ...(result.workerResult.interruption === undefined
        ? {}
        : { interruption: result.workerResult.interruption }),
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
  const worker = localAgentWorkerOutcome(workerResult);
  const verifier = localAgentEffectiveVerifierOutcome(workerResult, verifierResult);

  return verifier === undefined
    ? runtimeFinalTaskStatus({ worker })
    : runtimeFinalTaskStatus({ worker, verifier });
}

function localAgentResultStatus(
  status: Task["status"],
  workerResult?: LocalAgentWorkerResult
): RunLocalAgentTaskResult["status"] {
  return runtimeTaskResultStatus({
    taskStatus: status,
    ...(workerResult === undefined
      ? {}
      : { worker: localAgentWorkerOutcome(workerResult) })
  });
}

function localAgentWorkerRunStatus(
  status: Task["status"]
): "completed" | "waiting_approval" | "interrupted" | "blocked" | "failed" {
  return runtimeWorkerRunStatusFromTaskStatus(status);
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

function localAgentExecutionSemantics(input: {
  workerResult: LocalAgentWorkerResult;
  verifierResult?: RunTaskVerifiersResult;
}): RuntimeExecutionSemantics {
  const worker = localAgentWorkerOutcome(input.workerResult);
  const verifier = localAgentEffectiveVerifierOutcome(
    input.workerResult,
    input.verifierResult
  );

  return verifier === undefined
    ? runtimeExecutionSemantics({ worker })
    : runtimeExecutionSemantics({ worker, verifier });
}

function localAgentEffectiveVerifierOutcome(
  workerResult: LocalAgentWorkerResult,
  verifierResult: RunTaskVerifiersResult | undefined
): RuntimeVerifierOutcome | undefined {
  const explicit = localAgentVerifierOutcome(verifierResult);

  if (explicit !== undefined) {
    return explicit;
  }

  if (
    isCodexDirectLocalAgentWorkerResult(workerResult) &&
    workerResult.execution.verification !== "skipped"
  ) {
    return { status: workerResult.execution.verification };
  }

  return undefined;
}

function localAgentWorkerOutcome(
  workerResult: LocalAgentWorkerResult
): RuntimeWorkerOutcome {
  if (!isCodexDirectLocalAgentWorkerResult(workerResult)) {
    return {
      kind: "wrapped",
      exitCode: workerResult.exitCode
    };
  }

  return {
    kind: "governed",
    status: workerResult.status,
    toolCalls: workerResult.toolCalls,
    ...(workerResult.budget === undefined ? {} : { budgetExhausted: true })
  };
}

function localAgentVerifierOutcome(
  verifierResult: RunTaskVerifiersResult | undefined
): RuntimeVerifierOutcome | undefined {
  if (verifierResult === undefined) {
    return undefined;
  }

  return {
    status: localAgentVerifiersPassed(verifierResult) ? "passed" : "failed",
    taskStatus: verifierResult.task.status
  };
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
      execution: localAgentExecutionSemantics(input),
      outputValidation: input.workerResult.outputValidation,
      stdoutBytes: Buffer.byteLength(input.workerResult.stdout, "utf8"),
      stderrBytes: Buffer.byteLength(input.workerResult.stderr, "utf8"),
      stdoutOmitted: input.workerResult.stdout.length > 0,
      stderrOmitted: input.workerResult.stderr.length > 0,
      ...(wrappedWorkerModel(input.workerResult) === undefined
        ? { modelSource: wrappedWorkerDefaultModelSource(input.workerResult) }
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
    governance: localNativeWorkerGovernanceOutput(),
    execution: localAgentExecutionSemantics(input),
    ...(input.workerResult.warnings.length === 0
      ? {}
      : { warnings: input.workerResult.warnings }),
    ...(input.workerResult.interruption === undefined
      ? {}
      : { interruption: input.workerResult.interruption }),
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
      execution: localAgentExecutionSemantics(input),
      status: input.workerResult.exitCode === 0 ? "completed" : "failed",
      exitCode: input.workerResult.exitCode,
      outputValidation: input.workerResult.outputValidation,
      progress: input.workerResult.progress,
      stdoutBytes: Buffer.byteLength(input.workerResult.stdout, "utf8"),
      stderrBytes: Buffer.byteLength(input.workerResult.stderr, "utf8"),
      stdoutOmitted: input.workerResult.stdout.length > 0,
      stderrOmitted: input.workerResult.stderr.length > 0,
      ...(input.summary === undefined ? {} : { summary: input.summary }),
      ...(wrappedWorkerModel(input.workerResult) === undefined
        ? { modelSource: wrappedWorkerDefaultModelSource(input.workerResult) }
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
    governance: localNativeWorkerGovernanceOutput(),
    execution: localAgentExecutionSemantics(input),
    ...(input.workerResult.warnings.length === 0
      ? {}
      : { warnings: input.workerResult.warnings }),
    ...(input.workerResult.interruption === undefined
      ? {}
      : { interruption: input.workerResult.interruption }),
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

function formatExecutionSemanticsLines(execution: RuntimeExecutionSemantics): string[] {
  return [
    "Execution:",
    `  implementation: ${execution.implementation}`,
    `  verification: ${execution.verification}`,
    `  agentCompletion: ${execution.agentCompletion}`
  ];
}

function localAgentFailureExecution(
  agentCompletion: RuntimeExecutionSemantics["agentCompletion"]
): RuntimeExecutionSemantics {
  return {
    implementation: "not_applied",
    verification: "skipped",
    agentCompletion
  };
}

function localAgentFailureFromError(
  error: unknown,
  checkpoint?: WorkspaceCheckpoint
): {
  taskStatus: Task["status"];
  workerStatus: "failed" | "waiting_approval" | "blocked";
  resultStatus: RunLocalAgentTaskResult["status"];
  output: JsonObject;
  execution: RuntimeExecutionSemantics;
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
        execution: localAgentFailureExecution("approval_waiting"),
        ...(checkpoint === undefined ? {} : { checkpointId: checkpoint.id }),
        approval
      },
      execution: localAgentFailureExecution("approval_waiting"),
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
        execution: localAgentFailureExecution("blocked"),
        ...(checkpoint === undefined ? {} : { checkpointId: checkpoint.id })
      },
      execution: localAgentFailureExecution("blocked")
    };
  }

  const execution = localAgentFailureExecution("failed");

  return {
    taskStatus: "failed",
    workerStatus: "failed",
    resultStatus: "failed",
    output: {
      summary: error instanceof Error ? error.message : String(error),
      execution,
      ...(checkpoint === undefined ? {} : { checkpointId: checkpoint.id })
    },
    execution
  };
}

function isCodexDirectLocalAgentWorkerResult(
  workerResult: LocalAgentWorkerResult
): workerResult is CodexDirectWorkerResult {
  return workerResult.worker === CODEX_DIRECT_WORKER_KIND;
}

function localAgentWorkerCompleted(workerResult: LocalAgentWorkerResult): boolean {
  return isCodexDirectLocalAgentWorkerResult(workerResult)
    ? workerResult.status === "completed" ||
        (workerResult.status === "failed" &&
          (workerResult.budget !== undefined ||
            workerResult.toolCalls > 0 ||
            workerResult.execution.verification !== "skipped"))
    : workerResult.exitCode === 0;
}

function localAgentVerifiersPassed(
  verifierResult: RunTaskVerifiersResult | undefined
): boolean {
  return (
    verifierResult !== undefined &&
    verifierResult.commandResults.length > 0 &&
    verifierResult.commandResults.every(
      (result) => result.exitCode === 0 && result.timedOut === false
    )
  );
}

function redactedLocalWrappedWorkerArgs(
  workerResult: WrappedWorkerRunResult
): string[] {
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

function wrappedWorkerModelSource(workerResult: WrappedWorkerRunResult): string {
  return wrappedWorkerModel(workerResult) === undefined
    ? wrappedWorkerDefaultModelSource(workerResult)
    : "runstead_model_option";
}

function wrappedWorkerDefaultModelSource(workerResult: WrappedWorkerRunResult): string {
  return workerResult.worker === "codex_cli"
    ? "codex_cli_config"
    : "claude_code_config";
}

function wrappedWorkerDefaultModelLabel(workerResult: WrappedWorkerRunResult): string {
  return workerResult.worker === "codex_cli"
    ? "Codex CLI default"
    : "Claude Code CLI default";
}

function localWrappedWorkerGovernanceOutput(
  workerResult: WrappedWorkerRunResult
): JsonObject {
  const profile: LocalAgentWorkerGovernanceProfile = {
    level: "level_1_wrapper",
    enforcement: workerResult.governance.enforcement,
    boundary: "process_wrapper",
    hardProxyToolCalls: workerResult.governance.capabilities.hardProxyToolCalls,
    internalToolProxy: workerResult.governance.internalToolProxy.mode,
    policyEnforcement: "launch_gate",
    workspaceCheckpoint: workerResult.governance.capabilities.workspaceCheckpoint,
    postRunDiffVerification:
      workerResult.governance.capabilities.postRunDiffVerification,
    auditedActions: ["worker.external.start", "checkpoint", "diff_scope", "verifier"],
    limitations: [
      "worker-internal tool calls are governed only by the worker runtime",
      "Runstead verifies process launch, checkpoint, diff, and verifier evidence after exit"
    ]
  };

  return profile as unknown as JsonObject;
}

function localNativeWorkerGovernanceOutput(): JsonObject {
  const profile: LocalAgentWorkerGovernanceProfile = {
    level: "level_2_native_proxy",
    boundary: "native_tool_proxy",
    hardProxyToolCalls: true,
    internalToolProxy: "runstead_governed_actions",
    policyEnforcement: "per_tool_call",
    auditedActions: [
      "worker.native.start",
      "model.inference.request",
      "filesystem.read",
      "filesystem.write",
      "filesystem.patch",
      "shell.exec",
      "git.status",
      "git.diff",
      "git.log",
      "git.show",
      "verifier.run",
      "evidence.read",
      "workspace.facts.read"
    ],
    limitations: [
      "native proxy depends on Runstead-owned tool implementations",
      "external MCP/plugin ecosystems remain available through wrapped workers"
    ]
  };

  return profile as unknown as JsonObject;
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

function readLocalAgentApprovedPendingPatch(
  stateDb: string,
  task: Task
): CodexDirectPendingPatchResume | undefined {
  const approval = task.output?.approval;

  if (
    !isRecord(approval) ||
    approval.status !== "approved" ||
    typeof approval.id !== "string"
  ) {
    return undefined;
  }

  const database = openRunsteadDatabase(stateDb);

  try {
    return readApprovedCodexDirectPendingPatch(database, approval.id);
  } finally {
    database.close();
  }
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
