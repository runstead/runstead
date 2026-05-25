import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { CreateCiRepairTaskResult } from "./ci-repair.js";
import {
  gitCommitAction,
  gitDiffAction,
  gitStatusAction
} from "./ci-repair-orchestrator-actions.js";
import type { CiRepairOrchestratorStageContext } from "./ci-repair-orchestrator-context.js";
import { stageAtLeast } from "./ci-repair-orchestrator-context.js";
import {
  diffScopeOutput,
  gitChangedFilesOutput,
  gitCommitOutput
} from "./ci-repair-orchestrator-output.js";
import { markTaskTerminal } from "./ci-repair-orchestrator-task-state.js";
import { writeCiRepairStage } from "./ci-repair-orchestrator-stage-persistence.js";
import type {
  CiRepairGitRunner,
  CiRepairWorkerResult
} from "./ci-repair-orchestrator-types.js";
import { rollbackWorkerChanges } from "./ci-repair-orchestrator-worker-run.js";
import {
  verifyGitDiffScope,
  type GitDiffScopeVerification
} from "./diff-scope-verifier.js";
import {
  commitGitChanges,
  listGitChangedFiles,
  type CommitGitChangesResult
} from "./git-branch.js";
import { runGovernedToolAction } from "./governed-action.js";
import type { PolicyProfile } from "./policy.js";
import { finishWorkerRun } from "./runtime-audit.js";
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

  let diffScope = context.diffScope;

  if (!stageAtLeast(context.stage, "verified") || diffScope === undefined) {
    diffScope = await runGovernedToolAction({
      cwd: input.cwd,
      stateDb: input.stateDb,
      database: input.database,
      policy: input.policy,
      task,
      workerRun: input.workerRun,
      action: gitDiffAction({
        task,
        cwd: input.cwd,
        base: input.base,
        head: "HEAD"
      }),
      requestedBy: "runstead:ci-repair",
      ...(input.now === undefined ? {} : { now: input.now }),
      run: async () => {
        const value = await verifyGitDiffScope({
          cwd: input.cwd,
          baseRef: input.base,
          headRef: "HEAD",
          allowedPaths: input.allowedPaths ?? [],
          deniedPaths: input.deniedPaths ?? [],
          ...(input.gitRunner === undefined ? {} : { runner: input.gitRunner })
        });

        return {
          value,
          output: diffScopeOutput(value)
        };
      }
    }).then((result) => result.value);
  }

  if (diffScope === undefined) {
    throw new Error("CI repair diff scope context is missing");
  }

  if (diffScope.changedFiles.length === 0) {
    await rollbackWorkerChanges({
      cwd: input.cwd,
      root: input.root,
      stateDb: input.stateDb,
      database: input.database,
      policy: input.policy,
      task,
      workerRun: input.workerRun,
      workerResult: input.workerResult,
      ...(input.gitRunner === undefined ? {} : { gitRunner: input.gitRunner }),
      ...(input.now === undefined ? {} : { now: input.now })
    });
    markTaskTerminal({
      database: input.database,
      task,
      status: "failed",
      output: {
        ...(task.output ?? {}),
        ciRepairOrchestrator: {
          ...context,
          stage: "failed"
        },
        summary: "CI repair produced no git diff"
      },
      ...(input.now === undefined ? {} : { now: input.now })
    });
    finishWorkerRun({
      database: input.database,
      workerRun: input.workerRun,
      status: "failed",
      output: diffScopeOutput(diffScope),
      ...(input.now === undefined ? {} : { now: input.now })
    });
    throw new Error("CI repair produced no git diff");
  }

  if (!diffScope.passed) {
    await rollbackWorkerChanges({
      cwd: input.cwd,
      root: input.root,
      stateDb: input.stateDb,
      database: input.database,
      policy: input.policy,
      task,
      workerRun: input.workerRun,
      workerResult: input.workerResult,
      ...(input.gitRunner === undefined ? {} : { gitRunner: input.gitRunner }),
      ...(input.now === undefined ? {} : { now: input.now })
    });
    markTaskTerminal({
      database: input.database,
      task,
      status: "failed",
      output: {
        ...(task.output ?? {}),
        ciRepairOrchestrator: {
          ...context,
          stage: "failed"
        },
        summary: "CI repair diff scope failed",
        violations: diffScope.violations
      },
      ...(input.now === undefined ? {} : { now: input.now })
    });
    finishWorkerRun({
      database: input.database,
      workerRun: input.workerRun,
      status: "failed",
      output: diffScopeOutput(diffScope),
      ...(input.now === undefined ? {} : { now: input.now })
    });
    throw new Error(
      `CI repair diff scope failed with ${diffScope.violations.length} violation(s)`
    );
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
  const normalizedVerifierResult: RunTaskVerifiersResult = {
    ...verifierResult,
    task: {
      ...verifierResult.task,
      goalId: input.ciRepair.task.goalId,
      input: input.ciRepair.task.input,
      verifiers: input.ciRepair.task.verifiers,
      createdAt: input.ciRepair.task.createdAt
    }
  };

  if (normalizedVerifierResult.task.status !== "completed") {
    await rollbackWorkerChanges({
      cwd: input.cwd,
      root: input.root,
      stateDb: input.stateDb,
      database: input.database,
      policy: input.policy,
      task: normalizedVerifierResult.task,
      workerRun: input.workerRun,
      workerResult: input.workerResult,
      ...(input.gitRunner === undefined ? {} : { gitRunner: input.gitRunner }),
      ...(input.now === undefined ? {} : { now: input.now })
    });
    markTaskTerminal({
      database: input.database,
      task,
      status: "failed",
      output: {
        ...(task.output ?? {}),
        summary: "CI repair verifier failed",
        verifierTaskStatus: normalizedVerifierResult.task.status,
        ciRepairOrchestrator: {
          ...context,
          stage: "failed"
        }
      },
      ...(input.now === undefined ? {} : { now: input.now })
    });
    finishWorkerRun({
      database: input.database,
      workerRun: input.workerRun,
      status: "failed",
      output: {
        verifierTaskStatus: normalizedVerifierResult.task.status
      },
      ...(input.now === undefined ? {} : { now: input.now })
    });
    throw new Error(
      `CI repair verifier ended with task status ${normalizedVerifierResult.task.status}`
    );
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
