import { join, resolve } from "node:path";

import {
  createRunsteadId,
  type Goal,
  type JsonObject,
  type Task
} from "@runstead/core";
import {
  appendEventAndProject,
  openRunsteadDatabase,
  type RunsteadDatabase
} from "@runstead/state-sqlite";

import {
  recordWorkspaceCheckpointRestoreEvent,
  restoreWorkspaceCheckpoint,
  type WorkspaceCheckpoint
} from "./checkpoints.js";
import {
  CODEX_DIRECT_WORKER_KIND,
  runCodexDirectPendingPatchResume,
  runCodexDirectWorker,
  type CodexDirectTransport,
  type CodexDirectPendingPatchResume
} from "./codex-direct-worker.js";
import { runGovernedToolAction } from "./governed-action.js";
import { showGoal } from "./goals.js";
import { createLocalAgentCheckpointIfNeeded } from "./local-agent-checkpoint.js";
import { localAgentEvent, localAgentWorkerStartAction } from "./local-agent-actions.js";
import {
  localAgentShouldIncrementAttempt,
  localAgentTaskBaseUrl,
  localAgentTaskCheckpointId,
  localAgentTaskFinalizeOnBudget,
  localAgentTaskMaxTurns,
  localAgentTaskMode,
  localAgentTaskModel,
  localAgentTaskModelRequestTiming,
  localAgentTaskProvider,
  localAgentTaskToolBudget,
  localAgentTaskWorker,
  verifierCommandsFromLocalAgentTask,
  type LocalAgentWorkerKind
} from "./local-agent-task-input.js";
import {
  isCodexDirectLocalAgentWorkerResult,
  localAgentExecutionSemantics,
  localAgentFailureFromError,
  localAgentFinalSummary,
  localAgentFinalTaskStatus,
  localAgentResultStatus,
  localAgentTaskOutput,
  localAgentWorkerCompleted,
  localAgentWorkerOutput,
  localAgentWorkerRunStatus,
  type LocalAgentWorkerResult
} from "./local-agent-result.js";
import { summarizeLocalAgentAudit } from "./local-agent-report.js";
import { readLocalAgentApprovedPendingPatch } from "./local-agent-resume.js";
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
import {
  LOCAL_AGENT_TASK_TYPE,
  type CreateLocalAgentTaskOptions,
  type CreateLocalAgentTaskResult,
  type RunLocalAgentTaskOptions,
  type RunLocalAgentTaskResult,
  type UndoLocalAgentTaskOptions,
  type UndoLocalAgentTaskResult
} from "./local-agent-types.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import type { PolicyProfile } from "./policy.js";
import { requireRunsteadRoot, requireRunsteadStateDb } from "./runstead-root.js";
import { finishWorkerRun, startWorkerRun } from "./runtime-audit.js";
import { claimTask, showTask } from "./tasks.js";
import {
  runTaskVerifiersUnlocked,
  type RunTaskVerifiersResult
} from "./verifier-runner.js";
import {
  createModelProviderRuntime,
  resolveModelProviderModel
} from "./model-provider-runtime.js";
import {
  startWrappedWorker,
  type WorkerProcessRunner,
  type WorkerProcessProgress
} from "./wrapped-worker.js";

export { LOCAL_AGENT_TASK_TYPE } from "./local-agent-types.js";
export type { LocalAgentMode, LocalAgentWorkerKind } from "./local-agent-task-input.js";
export type {
  LocalAgentWorkerGovernanceProfile,
  LocalAgentWorkerResult
} from "./local-agent-result.js";
export type {
  CreateLocalAgentTaskOptions,
  CreateLocalAgentTaskResult,
  ResolveLocalAgentResumeTargetResult,
  RunLocalAgentTaskOptions,
  RunLocalAgentTaskResult,
  UndoLocalAgentTaskOptions,
  UndoLocalAgentTaskResult
} from "./local-agent-types.js";
export {
  formatLocalAgentTaskReport,
  formatLocalAgentTaskReportJson,
  formatLocalAgentTaskReportMarkdown,
  loadLocalAgentTaskReport
} from "./local-agent-report.js";
export {
  formatLocalAgentRunReport,
  formatLocalAgentUndoReport,
  localAgentRunExitCode
} from "./local-agent-run-report.js";
export {
  readLocalAgentApprovedPendingPatch,
  resolveLocalAgentResumeTarget
} from "./local-agent-resume.js";
export type {
  LocalAgentAuditCount,
  LocalAgentPolicyDecisionCount,
  LocalAgentTaskReport,
  LocalAgentReportToolCall,
  LocalAgentToolFailureKind
} from "./local-agent-report.js";

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
      action: localAgentWorkerStartAction({
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
