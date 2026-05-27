import { join, resolve } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { showGoal } from "./goals.js";
import { runLocalAgentTaskWithDatabase } from "./local-agent-orchestrator.js";
import { resolveLocalAgentRuntime } from "./local-agent-runtime.js";
import { isLocalAgentTask, startLocalAgentTask } from "./local-agent-task-state.js";
import type {
  RunLocalAgentTaskOptions,
  RunLocalAgentTaskResult
} from "./local-agent-types.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { requireRunsteadRoot, requireRunsteadStateDb } from "./runstead-root.js";
import { claimTask } from "./tasks.js";

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
