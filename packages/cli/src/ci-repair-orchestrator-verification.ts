import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { CreateCiRepairTaskResult } from "./ci-repair.js";
import { resolveCiRepairCommit } from "./ci-repair-orchestrator-commit.js";
import type { CiRepairOrchestratorStageContext } from "./ci-repair-orchestrator-context.js";
import { stageAtLeast } from "./ci-repair-orchestrator-context.js";
import { resolveCiRepairDiffScope } from "./ci-repair-orchestrator-diff-scope.js";
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
import type { CommitGitChangesResult } from "./git-branch.js";
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
  const commitResult = await resolveCiRepairCommit({
    cwd: input.cwd,
    stateDb: input.stateDb,
    database: input.database,
    policy: input.policy,
    task,
    workerRun: input.workerRun,
    context,
    ciRepair: input.ciRepair,
    ...(input.gitRunner === undefined ? {} : { gitRunner: input.gitRunner }),
    ...(input.onStagePersisted === undefined
      ? {}
      : { onStagePersisted: input.onStagePersisted }),
    ...(input.now === undefined ? {} : { now: input.now })
  });

  task = commitResult.task;
  context = commitResult.context;
  const commit = commitResult.commit;

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
