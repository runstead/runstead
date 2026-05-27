import { join, resolve } from "node:path";

import {
  recordWorkspaceCheckpointRestoreEvent,
  restoreWorkspaceCheckpoint
} from "./checkpoints.js";
import { localAgentTaskCheckpointId } from "./local-agent-task-input.js";
import { isLocalAgentTask } from "./local-agent-task-state.js";
import {
  type UndoLocalAgentTaskOptions,
  type UndoLocalAgentTaskResult
} from "./local-agent-types.js";
import { requireRunsteadRoot, requireRunsteadStateDb } from "./runstead-root.js";
import { showTask } from "./tasks.js";

export { LOCAL_AGENT_TASK_TYPE } from "./local-agent-types.js";
export { createLocalAgentTask } from "./local-agent-task-create.js";
export { attachLocalAgentVerifierEvidence } from "./local-agent-verifier-run.js";
export { runLocalAgentTask } from "./local-agent-run.js";
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
