import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { CreateCiRepairTaskResult } from "./ci-repair.js";
import { gitCommitAction, gitStatusAction } from "./ci-repair-orchestrator-actions.js";
import type { CiRepairOrchestratorStageContext } from "./ci-repair-orchestrator-context.js";
import { stageAtLeast } from "./ci-repair-orchestrator-context.js";
import { resolveCiRepairDiffScope } from "./ci-repair-orchestrator-diff-scope.js";
import {
  gitChangedFilesOutput,
  gitCommitOutput
} from "./ci-repair-orchestrator-output.js";
import { writeCiRepairStage } from "./ci-repair-orchestrator-stage-persistence.js";
import type {
  CiRepairGitRunner,
  CiRepairWorkerResult
} from "./ci-repair-orchestrator-types.js";
import {
  failCiRepairDiffScope,
  failCiRepairNoDiff,
  failCiRepairVerifier
} from "./ci-repair-orchestrator-verification-failures.js";
import { normalizeCiRepairVerifierResult } from "./ci-repair-orchestrator-verifier-result.js";
import type { GitDiffScopeVerification } from "./diff-scope-verifier.js";
import {
  commitGitChanges,
  listGitChangedFiles,
  type CommitGitChangesResult
} from "./git-branch.js";
import { runGovernedToolAction } from "./governed-action.js";
import type { PolicyProfile } from "./policy.js";
import {
  runTaskVerifiersUnlocked,
  type RunTaskVerifiersOptions,
  type RunTaskVerifiersResult
} from "./verifier-runner.js";

export interface VerifyCiRepairWorkerChangesInput {
  cwd: string;
  root: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  task: Task;
  workerRun: WorkerRun;
  context: CiRepairOrchestratorStageContext;
  ciRepair: CreateCiRepairTaskResult;
  base: string;
  workerResult: CiRepairWorkerResult;
  allowedPaths?: string[];
  deniedPaths?: string[];
  gitRunner?: CiRepairGitRunner;
  verifierRunner?: (
    options: RunTaskVerifiersOptions
  ) => Promise<RunTaskVerifiersResult>;
  onStagePersisted?: (stage: string, task: Task) => void;
  now?: Date;
}

export interface VerifyCiRepairWorkerChangesResult {
  task: Task;
  context: CiRepairOrchestratorStageContext;
  commit?: CommitGitChangesResult;
  diffScope: GitDiffScopeVerification;
  verifierResult: RunTaskVerifiersResult;
}

export async function verifyCiRepairWorkerChanges(
  input: VerifyCiRepairWorkerChangesInput
): Promise<VerifyCiRepairWorkerChangesResult> {
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

  const diffScope = await resolveCiRepairDiffScope({
    cwd: input.cwd,
    stateDb: input.stateDb,
    database: input.database,
    policy: input.policy,
    task,
    workerRun: input.workerRun,
    context,
    base: input.base,
    ...(input.allowedPaths === undefined ? {} : { allowedPaths: input.allowedPaths }),
    ...(input.deniedPaths === undefined ? {} : { deniedPaths: input.deniedPaths }),
    ...(input.gitRunner === undefined ? {} : { gitRunner: input.gitRunner }),
    ...(input.now === undefined ? {} : { now: input.now })
  });

  if (diffScope.changedFiles.length === 0) {
    await failCiRepairNoDiff({
      run: input,
      task,
      context,
      diffScope
    });
  }

  if (!diffScope.passed) {
    await failCiRepairDiffScope({
      run: input,
      task,
      context,
      diffScope
    });
  }

  const verifierResult =
    stageAtLeast(context.stage, "verified") &&
    context.verifierTask !== undefined &&
    context.verifierCommandResults !== undefined
      ? {
          task: context.verifierTask,
          commandResults: context.verifierCommandResults
        }
      : await (input.verifierRunner ?? runTaskVerifiersUnlocked)({
          cwd: input.cwd,
          taskId: task.id,
          claim: false,
          mode: "evidence_only",
          ...(input.now === undefined ? {} : { now: input.now })
        });
  const normalizedVerifierResult = normalizeCiRepairVerifierResult({
    verifierResult,
    ciRepairTask: input.ciRepair.task
  });

  if (normalizedVerifierResult.task.status !== "completed") {
    await failCiRepairVerifier({
      run: input,
      task,
      context,
      verifierResult: normalizedVerifierResult
    });
  }

  if (!stageAtLeast(context.stage, "verified")) {
    ({ task, context } = writeCiRepairStage({
      database: input.database,
      task,
      context,
      stage: "verified",
      patch: {
        diffScope,
        verifierTask: normalizedVerifierResult.task,
        verifierCommandResults: normalizedVerifierResult.commandResults
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
    ...(commit === undefined ? {} : { commit }),
    diffScope,
    verifierResult: normalizedVerifierResult
  };
}
