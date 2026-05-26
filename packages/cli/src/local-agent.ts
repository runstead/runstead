import { join, resolve } from "node:path";

import { type Goal, type Task } from "@runstead/core";
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
  type CodexDirectPendingPatchResume,
  type CodexDirectTransport
} from "./codex-direct-worker.js";
import { runGovernedToolAction } from "./governed-action.js";
import { showGoal } from "./goals.js";
import { createLocalAgentCheckpointIfNeeded } from "./local-agent-checkpoint.js";
import { localAgentEvent, localAgentWorkerStartAction } from "./local-agent-actions.js";
import {
  localAgentShouldIncrementAttempt,
  localAgentTaskBaseUrl,
  localAgentTaskCheckpointId,
  localAgentTaskModel,
  localAgentTaskProvider,
  localAgentTaskWorker,
  type LocalAgentWorkerKind
} from "./local-agent-task-input.js";
import { finalizeLocalAgentTask, isLocalAgentTask } from "./local-agent-task-state.js";
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
  localAgentWorkerRunStatus
} from "./local-agent-result.js";
import { summarizeLocalAgentAudit } from "./local-agent-report.js";
import { readLocalAgentApprovedPendingPatch } from "./local-agent-resume.js";
import { runLocalAgentVerifiersIfNeeded } from "./local-agent-verifier-run.js";
import { runLocalAgentWorker } from "./local-agent-worker-run.js";
import {
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
  createModelProviderRuntime,
  resolveModelProviderModel
} from "./model-provider-runtime.js";
import type { WorkerProcessProgress, WorkerProcessRunner } from "./wrapped-worker.js";

export { LOCAL_AGENT_TASK_TYPE } from "./local-agent-types.js";
export { createLocalAgentTask } from "./local-agent-task-create.js";
export { attachLocalAgentVerifierEvidence } from "./local-agent-verifier-run.js";
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
export { isLocalAgentTask } from "./local-agent-task-state.js";

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
