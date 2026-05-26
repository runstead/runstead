import { join, resolve } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

import {
  recordWorkspaceCheckpointRestoreEvent,
  restoreWorkspaceCheckpoint
} from "./checkpoints.js";
import { showGoal } from "./goals.js";
import { localAgentTaskCheckpointId } from "./local-agent-task-input.js";
import { runLocalAgentTaskWithDatabase } from "./local-agent-orchestrator.js";
import { resolveLocalAgentRuntime } from "./local-agent-runtime.js";
import { isLocalAgentTask, startLocalAgentTask } from "./local-agent-task-state.js";
import {
  type RunLocalAgentTaskOptions,
  type RunLocalAgentTaskResult,
  type UndoLocalAgentTaskOptions,
  type UndoLocalAgentTaskResult
} from "./local-agent-types.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { requireRunsteadRoot, requireRunsteadStateDb } from "./runstead-root.js";
import { claimTask, showTask } from "./tasks.js";

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
