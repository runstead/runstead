import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { CreateCiRepairTaskResult } from "./ci-repair.js";
import {
  buildPullRequestResumeContext,
  type CiRepairOrchestratorResumeContext,
  type CiRepairOrchestratorStageContext
} from "./ci-repair-orchestrator-context.js";
import { publishCiRepairPullRequest } from "./ci-repair-orchestrator-publish-flow.js";
import { writeCiRepairStage } from "./ci-repair-orchestrator-stage-persistence.js";
import type {
  CiRepairWorkerResult,
  RunCiRepairOrchestratorOptions,
  RunCiRepairOrchestratorResult
} from "./ci-repair-orchestrator-types.js";
import { verifyCiRepairWorkerChanges } from "./ci-repair-orchestrator-verification.js";
import type { PolicyProfile } from "./policy.js";

export interface ExecuteCiRepairPublishStageInput {
  cwd: string;
  root: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  task: Task;
  workerRun: WorkerRun;
  context: CiRepairOrchestratorStageContext;
  ciRepair: CreateCiRepairTaskResult;
  branchName: string;
  base: string;
  workerResult: CiRepairWorkerResult;
  options: RunCiRepairOrchestratorOptions;
  onOrchestratorStateUpdated?: (state: {
    task: Task;
    context: CiRepairOrchestratorStageContext;
  }) => void;
}

export async function executeCiRepairPublishStage(
  input: ExecuteCiRepairPublishStageInput
): Promise<RunCiRepairOrchestratorResult> {
  let orchestratorTask = input.task;
  let stageContext = input.context;
  const verifiedChanges = await verifyCiRepairWorkerChanges({
    cwd: input.cwd,
    root: input.root,
    stateDb: input.stateDb,
    database: input.database,
    policy: input.policy,
    task: orchestratorTask,
    workerRun: input.workerRun,
    context: stageContext,
    ciRepair: input.ciRepair,
    base: input.base,
    workerResult: input.workerResult,
    ...(input.options.allowedPaths === undefined
      ? {}
      : { allowedPaths: input.options.allowedPaths }),
    ...(input.options.deniedPaths === undefined
      ? {}
      : { deniedPaths: input.options.deniedPaths }),
    ...(input.options.gitRunner === undefined
      ? {}
      : { gitRunner: input.options.gitRunner }),
    ...(input.options.verifierRunner === undefined
      ? {}
      : { verifierRunner: input.options.verifierRunner }),
    ...(input.options.onStagePersisted === undefined
      ? {}
      : { onStagePersisted: input.options.onStagePersisted }),
    ...(input.options.now === undefined ? {} : { now: input.options.now })
  });
  orchestratorTask = verifiedChanges.task;
  stageContext = verifiedChanges.context;
  input.onOrchestratorStateUpdated?.({
    task: orchestratorTask,
    context: stageContext
  });

  const {
    commit,
    diffScope,
    verifierResult: normalizedVerifierResult
  } = verifiedChanges;
  const resumeContext: CiRepairOrchestratorResumeContext = {
    ...stageContext,
    ...buildPullRequestResumeContext({
      ciRepair: input.ciRepair,
      branchName: input.branchName,
      base: input.base,
      draft: input.options.draft === true,
      workerResult: input.workerResult,
      ...(commit === undefined ? {} : { commit }),
      diffScope,
      verifierResult: normalizedVerifierResult
    })
  };
  ({ task: orchestratorTask, context: stageContext } = writeCiRepairStage({
    database: input.database,
    task: orchestratorTask,
    context: resumeContext,
    stage: "ready_for_push",
    ...(input.options.onStagePersisted === undefined
      ? {}
      : { onStagePersisted: input.options.onStagePersisted }),
    ...(input.options.now === undefined ? {} : { now: input.options.now })
  }));
  input.onOrchestratorStateUpdated?.({
    task: orchestratorTask,
    context: stageContext
  });

  const publishResult = await publishCiRepairPullRequest({
    cwd: input.cwd,
    stateDb: input.stateDb,
    database: input.database,
    policy: input.policy,
    task: orchestratorTask,
    workerRun: input.workerRun,
    ciRepair: input.ciRepair,
    context: stageContext as CiRepairOrchestratorResumeContext,
    ...(input.options.gitRunner === undefined
      ? {}
      : { gitRunner: input.options.gitRunner }),
    ...(input.options.githubRunner === undefined
      ? {}
      : { githubRunner: input.options.githubRunner }),
    ...(input.options.authToken === undefined
      ? {}
      : { authToken: input.options.authToken }),
    ...(input.options.onStagePersisted === undefined
      ? {}
      : { onStagePersisted: input.options.onStagePersisted }),
    ...(input.options.now === undefined ? {} : { now: input.options.now })
  });

  if (publishResult.status === "waiting_approval") {
    return {
      status: "waiting_approval",
      ciRepair: {
        ...input.ciRepair,
        task: publishResult.task
      },
      branchName: input.branchName,
      workerResult: input.workerResult,
      ...(commit === undefined ? {} : { commit }),
      diffScope,
      verifierResult: {
        ...normalizedVerifierResult,
        task: publishResult.task
      },
      approval: publishResult.approval
    };
  }

  return {
    status: "completed",
    ciRepair: {
      ...input.ciRepair,
      task: publishResult.task
    },
    branchName: input.branchName,
    workerResult: input.workerResult,
    ...(commit === undefined ? {} : { commit }),
    diffScope,
    verifierResult: {
      ...normalizedVerifierResult,
      task: publishResult.task
    },
    pullRequest: publishResult.pullRequest
  };
}
