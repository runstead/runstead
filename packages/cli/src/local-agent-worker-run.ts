import { join } from "node:path";

import type { Goal, Task } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { WorkspaceCheckpoint } from "./checkpoints.js";
import {
  CODEX_DIRECT_WORKER_KIND,
  runCodexDirectPendingPatchResume,
  runCodexDirectWorker,
  type CodexDirectPendingPatchResume,
  type CodexDirectTransport
} from "./codex-direct-worker.js";
import {
  localAgentTaskFinalizeOnBudget,
  localAgentTaskMaxTurns,
  localAgentTaskModel,
  localAgentTaskModelRequestTiming,
  localAgentTaskToolBudget,
  localAgentTaskWorker,
  verifierCommandsFromLocalAgentTask,
  type LocalAgentWorkerKind
} from "./local-agent-task-input.js";
import type { LocalAgentWorkerResult } from "./local-agent-result.js";
import {
  buildLocalAgentPrompt,
  localAgentAllowedScope,
  localAgentApprovalRequired,
  localAgentDeniedActions
} from "./local-agent-prompt.js";
import type { PolicyProfile } from "./policy.js";
import { buildTaskContextPack } from "./task-context-pack.js";
import {
  startWrappedWorker,
  type WorkerProcessProgress,
  type WorkerProcessRunner
} from "./wrapped-worker.js";

export interface RunLocalAgentWorkerOptions {
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
}

export async function runLocalAgentWorker(
  options: RunLocalAgentWorkerOptions
): Promise<LocalAgentWorkerResult> {
  const contextPack =
    options.pendingPatchResume === undefined
      ? buildTaskContextPack({
          cwd: options.cwd,
          database: options.database,
          goal: options.goal,
          task: options.task,
          ...(options.now === undefined ? {} : { now: options.now })
        })
      : undefined;

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
      prompt: buildLocalAgentPrompt(options.task, { contextPack }),
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
      instructions: [buildLocalAgentPrompt(options.task, { contextPack })],
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

export function localAgentWorkerKindForTask(task: Task): LocalAgentWorkerKind {
  return localAgentTaskWorker(task);
}
