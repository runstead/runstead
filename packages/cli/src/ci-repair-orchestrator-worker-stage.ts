import type { Goal, Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { CreateCiRepairTaskResult } from "./ci-repair.js";
import { workerStartAction } from "./ci-repair-orchestrator-actions.js";
import {
  incrementCiRepairCounter,
  stageAtLeast,
  type CiRepairOrchestratorStageContext
} from "./ci-repair-orchestrator-context.js";
import { writeCiRepairStage } from "./ci-repair-orchestrator-stage-persistence.js";
import type {
  CiRepairWorkerResult,
  RunCiRepairOrchestratorOptions
} from "./ci-repair-orchestrator-types.js";
import {
  durableWorkerResult,
  workerOutput
} from "./ci-repair-orchestrator-worker-output.js";
import { startCiRepairWorker } from "./ci-repair-orchestrator-worker-run.js";
import type { WorkspaceCheckpoint } from "./checkpoints.js";
import { runGovernedToolAction } from "./governed-action.js";
import type { PolicyProfile } from "./policy.js";

export interface ExecuteCiRepairWorkerStageInput {
  cwd: string;
  root: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  goal: Goal;
  task: Task;
  workerRun: WorkerRun;
  context: CiRepairOrchestratorStageContext;
  ciRepair: CreateCiRepairTaskResult;
  checkpointBefore: WorkspaceCheckpoint;
  options: RunCiRepairOrchestratorOptions;
}

export interface ExecuteCiRepairWorkerStageResult {
  task: Task;
  context: CiRepairOrchestratorStageContext;
  workerResult: CiRepairWorkerResult;
}

export async function executeCiRepairWorkerStage(
  input: ExecuteCiRepairWorkerStageInput
): Promise<ExecuteCiRepairWorkerStageResult> {
  let task = input.task;
  let context = input.context;
  let workerResult = context.workerResult;

  if (!stageAtLeast(context.stage, "worker_completed") || workerResult === undefined) {
    workerResult = await runGovernedToolAction({
      cwd: input.cwd,
      stateDb: input.stateDb,
      database: input.database,
      policy: input.policy,
      task,
      workerRun: input.workerRun,
      action: workerStartAction({
        task,
        cwd: input.cwd,
        worker: input.options.worker
      }),
      requestedBy: "runstead:ci-repair",
      ...(input.options.now === undefined ? {} : { now: input.options.now }),
      run: async () => {
        const value = await startCiRepairWorker({
          cwd: input.cwd,
          root: input.root,
          stateDb: input.stateDb,
          database: input.database,
          policy: input.policy,
          goal: input.goal,
          task,
          worker: input.options.worker,
          ...(input.options.provider === undefined
            ? {}
            : { provider: input.options.provider }),
          ...(input.options.model === undefined ? {} : { model: input.options.model }),
          ...(input.options.baseUrl === undefined
            ? {}
            : { baseUrl: input.options.baseUrl }),
          checkpointBefore: input.checkpointBefore,
          workflowRunId: input.ciRepair.workflowRun.runId,
          evidenceId: input.ciRepair.evidence.id,
          verifierCommands: input.options.verifierCommands,
          allowedPaths: input.options.allowedPaths ?? [],
          deniedPaths: input.options.deniedPaths ?? [],
          ...(input.options.workerRunner === undefined
            ? {}
            : { workerRunner: input.options.workerRunner }),
          ...(input.options.codexDirectTransport === undefined
            ? {}
            : { codexDirectTransport: input.options.codexDirectTransport }),
          ...(input.options.now === undefined ? {} : { now: input.options.now })
        });

        return {
          value,
          output: workerOutput(value)
        };
      }
    }).then((result) => result.value);
    context = {
      ...context,
      counters: incrementCiRepairCounter(context, "workerAttempt")
    };
    if (workerResult === undefined) {
      throw new Error("CI repair worker result context is missing");
    }
    ({ task, context } = writeCiRepairStage({
      database: input.database,
      task,
      context,
      stage: "worker_completed",
      patch: {
        workerResult: durableWorkerResult(workerResult)
      },
      ...(input.options.onStagePersisted === undefined
        ? {}
        : { onStagePersisted: input.options.onStagePersisted }),
      ...(input.options.now === undefined ? {} : { now: input.options.now })
    }));
  }

  if (workerResult === undefined) {
    throw new Error("CI repair worker result context is missing");
  }

  return {
    task,
    context,
    workerResult
  };
}
