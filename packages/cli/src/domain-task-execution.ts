import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import type { Task } from "@runstead/core";
import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { showGoal } from "./goals.js";
import { storeRepoInspectionEvidence } from "./inspection-evidence.js";
import { runLocalAgentTaskWithDatabase } from "./local-agent-orchestrator.js";
import type { RunLocalAgentTaskResult } from "./local-agent.js";
import { resolveLocalAgentRuntime } from "./local-agent-runtime.js";
import { startLocalAgentTask } from "./local-agent-task-state.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { requireRunsteadRoot, requireRunsteadStateDb } from "./runstead-root.js";
import type { RunOnceOptions } from "./run-types.js";
import { blockTask, claimTask, completeTask } from "./tasks.js";
import { runTaskVerifiersUnlocked } from "./verifier-runner.js";
import { configuredVerifierCommandsFromTask } from "./verifier-runner-task-input.js";

export interface RunGenericDomainTaskResult {
  task: Task;
  commandResults?: Awaited<
    ReturnType<typeof runTaskVerifiersUnlocked>
  >["commandResults"];
  localAgentResult?: RunLocalAgentTaskResult;
}

export function isGenericDomainTask(task: Task): boolean {
  return (
    typeof task.input.taskType === "string" &&
    isRecord(task.input.workerRouting) &&
    task.type === task.input.taskType
  );
}

export async function runGenericDomainTask(input: {
  cwd: string;
  task: Task;
  options: RunOnceOptions;
}): Promise<RunGenericDomainTaskResult> {
  if (canRunCommandVerifiers(input.task)) {
    const result = await runTaskVerifiersUnlocked({
      cwd: input.cwd,
      taskId: input.task.id,
      ...(input.options.now === undefined ? {} : { now: input.options.now })
    });

    return {
      task: result.task,
      commandResults: result.commandResults
    };
  }

  if (input.task.verifiers.includes("evidence:repo_inspection")) {
    const result = await runRepoInspectionTask(input);

    return {
      task: result.task
    };
  }

  if (typeof input.task.input.worker === "string") {
    const result = await runDomainAgentTask(input);

    return {
      task: result.task,
      localAgentResult: result
    };
  }

  const blocked = blockTask({
    cwd: input.cwd,
    task: input.task,
    reason: "evidence_required",
    output: {
      summary:
        "This domain task needs external or manual evidence before automation can complete it.",
      verifiers: input.task.verifiers,
      workerRouting: input.task.input.workerRouting
    },
    ...(input.options.now === undefined ? {} : { now: input.options.now })
  });

  return {
    task: blocked.task
  };
}

async function runRepoInspectionTask(input: {
  cwd: string;
  task: Task;
  options: RunOnceOptions;
}): Promise<ReturnType<typeof completeTask>> {
  const claimed = claimTask({
    cwd: input.cwd,
    id: input.task.id,
    ...(input.options.now === undefined ? {} : { now: input.options.now })
  }).task;
  const root = await requireRunsteadRoot(input.cwd);
  const state = await requireRunsteadStateDb(input.cwd);
  const database = openRunsteadDatabase(state.stateDb);
  let evidenceId: string;

  try {
    const evidence = await storeRepoInspectionEvidence({
      cwd: input.cwd,
      runsteadRoot: root.root,
      database,
      ...(input.options.now === undefined ? {} : { now: input.options.now })
    });
    evidenceId = evidence.evidence.id;
  } finally {
    database.close();
  }

  return completeTask({
    cwd: input.cwd,
    task: claimed,
    output: {
      summary: "Repository inspection evidence recorded.",
      evidenceIds: [evidenceId],
      verifiers: claimed.verifiers
    },
    ...(input.options.now === undefined ? {} : { now: input.options.now })
  });
}

async function runDomainAgentTask(input: {
  cwd: string;
  task: Task;
  options: RunOnceOptions;
}): Promise<Awaited<ReturnType<typeof runLocalAgentTaskWithDatabase>>> {
  const cwd = resolve(input.cwd);
  const root = await requireRunsteadRoot(cwd);
  const state = await requireRunsteadStateDb(cwd);
  const claimed = claimTask({
    cwd,
    id: input.task.id,
    ...(input.options.now === undefined ? {} : { now: input.options.now })
  }).task;
  const runtime = await resolveLocalAgentRuntime({
    cwd,
    stateDb: state.stateDb,
    task: claimed,
    ...(input.options.codexDirectTransport === undefined
      ? {}
      : { transport: input.options.codexDirectTransport }),
    ...(input.options.now === undefined ? {} : { now: input.options.now })
  });
  const goal = showGoal({ cwd, id: claimed.goalId }).goal;
  const policy = await loadPolicyProfileFromFile(
    resolveDomainPolicyPath({
      root: root.root,
      domain: claimed.domain,
      ...(goal.policyRef === undefined ? {} : { policyRef: goal.policyRef })
    })
  );
  const database = openRunsteadDatabase(state.stateDb);

  try {
    const runningTask = startLocalAgentTask({
      database,
      task: claimed,
      ...(input.options.now === undefined ? {} : { now: input.options.now })
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
      ...(input.options.workerRunner === undefined
        ? {}
        : { workerRunner: input.options.workerRunner }),
      ...(input.options.now === undefined ? {} : { now: input.options.now })
    });
  } finally {
    database.close();
  }
}

function canRunCommandVerifiers(task: Task): boolean {
  return (
    configuredVerifierCommandsFromTask(task).length > 0 ||
    task.type === "run_mvp_verifiers"
  );
}

function resolveDomainPolicyPath(input: {
  root: string;
  domain: string;
  policyRef?: string;
}): string {
  const policyRef = input.policyRef ?? "policies/repo-maintenance.yaml";
  const candidates = [
    join(input.root, "domains", input.domain, policyRef),
    join(input.root, policyRef),
    join(input.root, "policies", basename(policyRef))
  ];
  const match = candidates.find((candidate) => existsSync(candidate));

  if (match === undefined) {
    throw new Error(
      `Policy ${policyRef} was not found for domain task ${input.domain}`
    );
  }

  return match;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
