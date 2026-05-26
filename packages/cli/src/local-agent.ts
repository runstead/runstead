import { join, resolve } from "node:path";

import { type Goal, type Task } from "@runstead/core";
import { openRunsteadDatabase, type RunsteadDatabase } from "@runstead/state-sqlite";

import {
  recordWorkspaceCheckpointRestoreEvent,
  restoreWorkspaceCheckpoint,
  type WorkspaceCheckpoint
} from "./checkpoints.js";
import type {
  CodexDirectPendingPatchResume,
  CodexDirectTransport
} from "./codex-direct-worker.js";
import { runGovernedToolAction } from "./governed-action.js";
import { showGoal } from "./goals.js";
import { createLocalAgentCheckpointIfNeeded } from "./local-agent-checkpoint.js";
import { localAgentWorkerStartAction } from "./local-agent-actions.js";
import {
  localAgentTaskCheckpointId,
  type LocalAgentWorkerKind
} from "./local-agent-task-input.js";
import { resolveLocalAgentRuntime } from "./local-agent-runtime.js";
import {
  finalizeLocalAgentTask,
  isLocalAgentTask,
  startLocalAgentTask
} from "./local-agent-task-state.js";
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

  const runtime = await resolveLocalAgentRuntime({
    cwd,
    stateDb: state.stateDb,
    task: claimedTask,
    ...(options.transport === undefined ? {} : { transport: options.transport }),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  const goal = showGoal({ cwd, id: claimedTask.goalId }).goal;
  const policy = await loadPolicyProfileFromFile(
    join(root.root, "policies", "repo-maintenance.yaml")
  );
  const database = openRunsteadDatabase(state.stateDb);

  try {
    const runningTask = startLocalAgentTask({
      database,
      task: claimedTask,
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return await runLocalAgentTaskWithDatabase({
      cwd,
      root: root.root,
      stateDb: state.stateDb,
      database,
      policy,
      goal,
      task: runningTask,
      worker: runtime.worker,
      ...(runtime.pendingPatchResume === undefined
        ? {}
        : { pendingPatchResume: runtime.pendingPatchResume }),
      ...(runtime.model === undefined ? {} : { model: runtime.model }),
      ...(runtime.modelProviderResourceId === undefined
        ? {}
        : { modelProviderResourceId: runtime.modelProviderResourceId }),
      ...(runtime.modelProviderNetworkDomains === undefined
        ? {}
        : { modelProviderNetworkDomains: runtime.modelProviderNetworkDomains }),
      ...(runtime.transport === undefined ? {} : { transport: runtime.transport }),
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
