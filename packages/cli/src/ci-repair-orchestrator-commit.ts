import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { CreateCiRepairTaskResult } from "./ci-repair.js";
import {
  gitCommitAction,
  gitStatusAction
} from "./ci-repair-orchestrator-actions.js";
import type { CiRepairOrchestratorStageContext } from "./ci-repair-orchestrator-context.js";
import { stageAtLeast } from "./ci-repair-orchestrator-context.js";
import {
  gitChangedFilesOutput,
  gitCommitOutput
} from "./ci-repair-orchestrator-output.js";
import { writeCiRepairStage } from "./ci-repair-orchestrator-stage-persistence.js";
import type { CiRepairGitRunner } from "./ci-repair-orchestrator-types.js";
import {
  commitGitChanges,
  listGitChangedFiles,
  type CommitGitChangesResult
} from "./git-branch.js";
import { runGovernedToolAction } from "./governed-action.js";
import type { PolicyProfile } from "./policy.js";

export interface ResolveCiRepairCommitInput {
  cwd: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  task: Task;
  workerRun: WorkerRun;
  context: CiRepairOrchestratorStageContext;
  ciRepair: CreateCiRepairTaskResult;
  gitRunner?: CiRepairGitRunner;
  onStagePersisted?: (stage: string, task: Task) => void;
  now?: Date;
}

export interface ResolveCiRepairCommitResult {
  task: Task;
  context: CiRepairOrchestratorStageContext;
  commit?: CommitGitChangesResult;
}

export async function resolveCiRepairCommit(
  input: ResolveCiRepairCommitInput
): Promise<ResolveCiRepairCommitResult> {
  let task = input.task;
  let context = input.context;
  const changedFiles = await runGovernedToolAction({
    cwd: input.cwd,
    stateDb: input.stateDb,
    database: input.database,
    policy: input.policy,
    task,
    workerRun: input.workerRun,
    action: gitStatusAction({
      task,
      cwd: input.cwd
    }),
    requestedBy: "runstead:ci-repair",
    ...(input.now === undefined ? {} : { now: input.now }),
    run: async () => {
      const value = await listGitChangedFiles({
        cwd: input.cwd,
        ...(input.gitRunner === undefined ? {} : { runner: input.gitRunner })
      });

      return {
        value,
        output: gitChangedFilesOutput(value)
      };
    }
  }).then((result) => result.value);
  const hasCommittableChanges =
    changedFiles.changedFiles.length > changedFiles.excludedFiles.length;
  let commit = context.commit;

  if (
    (!stageAtLeast(context.stage, "committed") || commit === undefined) &&
    hasCommittableChanges
  ) {
    commit = await runGovernedToolAction({
      cwd: input.cwd,
      stateDb: input.stateDb,
      database: input.database,
      policy: input.policy,
      task,
      workerRun: input.workerRun,
      action: gitCommitAction({
        task,
        cwd: input.cwd,
        changedFiles: changedFiles.changedFiles
      }),
      requestedBy: "runstead:ci-repair",
      ...(input.now === undefined ? {} : { now: input.now }),
      run: async () => {
        const value = await commitGitChanges({
          cwd: input.cwd,
          message: `Runstead repair CI run ${input.ciRepair.workflowRun.runId}`,
          changedFiles: changedFiles.changedFiles,
          ...(input.gitRunner === undefined ? {} : { runner: input.gitRunner })
        });

        return {
          value,
          output: gitCommitOutput(value)
        };
      }
    }).then((result) => result.value);
    if (commit === undefined) {
      throw new Error("CI repair commit context is missing");
    }
    ({ task, context } = writeCiRepairStage({
      database: input.database,
      task,
      context,
      stage: "committed",
      patch: {
        commit
      },
      ...(input.onStagePersisted === undefined
        ? {}
        : { onStagePersisted: input.onStagePersisted }),
      ...(input.now === undefined ? {} : { now: input.now })
    }));
  }

  return {
    task,
    context,
    ...(commit === undefined ? {} : { commit })
  };
}
