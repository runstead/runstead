import { join } from "node:path";

import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import {
  createWorkspaceCheckpoint,
  recordWorkspaceCheckpointCreatedEvent,
  type WorkspaceCheckpoint
} from "./checkpoints.js";
import { createGitBranch } from "./git-branch.js";
import {
  checkpointCreateAction,
  gitBranchCreateAction
} from "./ci-repair-orchestrator-actions.js";
import type { CiRepairOrchestratorStageContext } from "./ci-repair-orchestrator-context.js";
import { stageAtLeast } from "./ci-repair-orchestrator-context.js";
import { checkpointOutput } from "./ci-repair-orchestrator-output.js";
import { writeCiRepairStage } from "./ci-repair-orchestrator-stage-persistence.js";
import type { CiRepairGitRunner } from "./ci-repair-orchestrator-types.js";
import { runGovernedToolAction } from "./governed-action.js";
import type { PolicyProfile } from "./policy.js";

export interface PrepareCiRepairWorkspaceInput {
  cwd: string;
  root: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  task: Task;
  workerRun: WorkerRun;
  context: CiRepairOrchestratorStageContext;
  branchName: string;
  base: string;
  gitRunner?: CiRepairGitRunner;
  onStagePersisted?: (stage: string, task: Task) => void;
  now?: Date;
}

export interface PrepareCiRepairWorkspaceResult {
  task: Task;
  context: CiRepairOrchestratorStageContext;
  checkpointBefore: WorkspaceCheckpoint;
}

export async function prepareCiRepairWorkspace(
  input: PrepareCiRepairWorkspaceInput
): Promise<PrepareCiRepairWorkspaceResult> {
  let task = input.task;
  let context = input.context;

  if (!stageAtLeast(context.stage, "branch_created")) {
    await runGovernedToolAction({
      cwd: input.cwd,
      stateDb: input.stateDb,
      database: input.database,
      policy: input.policy,
      task,
      workerRun: input.workerRun,
      action: gitBranchCreateAction({
        task,
        cwd: input.cwd,
        branchName: input.branchName,
        base: input.base
      }),
      requestedBy: "runstead:ci-repair",
      ...(input.now === undefined ? {} : { now: input.now }),
      run: async () => {
        const value = await createGitBranch({
          cwd: input.cwd,
          branchName: input.branchName,
          baseRef: input.base,
          ...(input.gitRunner === undefined ? {} : { runner: input.gitRunner })
        });

        return {
          value,
          output: {
            branchName: value.branchName,
            baseRef: value.baseRef ?? input.base
          }
        };
      }
    });
    ({ task, context } = writeCiRepairStage({
      database: input.database,
      task,
      context,
      stage: "branch_created",
      patch: {
        branchName: input.branchName,
        base: input.base
      },
      ...(input.onStagePersisted === undefined
        ? {}
        : { onStagePersisted: input.onStagePersisted }),
      ...(input.now === undefined ? {} : { now: input.now })
    }));
  }

  let checkpointBefore = context.checkpointBefore;

  if (
    !stageAtLeast(context.stage, "checkpoint_created") ||
    checkpointBefore === undefined
  ) {
    const checkpointResult = await runGovernedToolAction({
      cwd: input.cwd,
      stateDb: input.stateDb,
      database: input.database,
      policy: input.policy,
      task,
      workerRun: input.workerRun,
      action: checkpointCreateAction({
        task,
        cwd: input.cwd,
        checkpointDir: join(input.root, "checkpoints")
      }),
      requestedBy: "runstead:ci-repair",
      ...(input.now === undefined ? {} : { now: input.now }),
      run: async () => {
        const value = await createWorkspaceCheckpoint({
          workspace: input.cwd,
          checkpointDir: join(input.root, "checkpoints"),
          ...(input.now === undefined ? {} : { now: input.now }),
          ...(input.gitRunner === undefined ? {} : { runner: input.gitRunner })
        });
        recordWorkspaceCheckpointCreatedEvent({
          stateDb: input.stateDb,
          checkpoint: value,
          actor: "runstead:ci-repair",
          ...(input.now === undefined ? {} : { now: input.now })
        });

        return {
          value,
          output: checkpointOutput(value)
        };
      }
    });
    checkpointBefore = checkpointResult.value;
    ({ task, context } = writeCiRepairStage({
      database: input.database,
      task,
      context,
      stage: "checkpoint_created",
      patch: {
        checkpointBefore
      },
      ...(input.onStagePersisted === undefined
        ? {}
        : { onStagePersisted: input.onStagePersisted }),
      ...(input.now === undefined ? {} : { now: input.now })
    }));
  }

  if (checkpointBefore === undefined) {
    throw new Error("CI repair checkpoint context is missing");
  }

  return {
    task,
    context,
    checkpointBefore
  };
}
