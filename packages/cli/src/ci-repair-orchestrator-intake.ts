import {
  createCiRepairTaskFromWorkflowRunUnlocked,
  isCreatedCiRepairTaskResult,
  type CreateCiRepairTaskResult
} from "./ci-repair.js";
import {
  buildInitialCiRepairStageContext,
  ciRepairStageContext,
  type CiRepairOrchestratorStageContext
} from "./ci-repair-orchestrator-context.js";
import type {
  RunCiRepairOrchestratorOptions,
  RunCiRepairOrchestratorResult
} from "./ci-repair-orchestrator-types.js";
import { buildRunsteadBranchName } from "./git-branch.js";
import { claimTask } from "./tasks.js";

export type PrepareCiRepairOrchestratorIntakeResult =
  | {
      status: "ignored";
      result: RunCiRepairOrchestratorResult;
    }
  | {
      status: "ready";
      ciRepair: CreateCiRepairTaskResult;
      base: string;
      branchName: string;
      stageContext: CiRepairOrchestratorStageContext;
      restoredStageContext?: CiRepairOrchestratorStageContext;
    };

export async function prepareCiRepairOrchestratorIntake(input: {
  cwd: string;
  options: RunCiRepairOrchestratorOptions;
}): Promise<PrepareCiRepairOrchestratorIntakeResult> {
  if (input.options.verifierCommands.length === 0) {
    throw new Error("At least one verifier command is required for CI repair");
  }

  const queuedCiRepair = await createCiRepairTaskFromWorkflowRunUnlocked({
    cwd: input.cwd,
    runId: input.options.runId,
    verifierCommands: input.options.verifierCommands,
    ...(input.options.authToken === undefined
      ? {}
      : { authToken: input.options.authToken }),
    ...(input.options.githubRunner === undefined
      ? {}
      : { runner: input.options.githubRunner }),
    ...(input.options.now === undefined ? {} : { now: input.options.now })
  });

  if (!isCreatedCiRepairTaskResult(queuedCiRepair)) {
    return {
      status: "ignored",
      result: {
        status: "ignored",
        ciRepair: queuedCiRepair
      }
    };
  }

  if (queuedCiRepair.task.status !== "queued") {
    throw new Error(
      `CI repair task ${queuedCiRepair.task.id} is ${queuedCiRepair.task.status}, expected queued`
    );
  }

  const ciRepair: CreateCiRepairTaskResult = {
    ...queuedCiRepair,
    task: claimTask({
      cwd: input.cwd,
      id: queuedCiRepair.task.id,
      ...(input.options.now === undefined ? {} : { now: input.options.now })
    }).task
  };
  const base = input.options.base ?? ciRepair.workflowRun.headBranch ?? "main";
  const branchName = buildRunsteadBranchName({
    taskId: ciRepair.task.id,
    slug: `ci-${ciRepair.workflowRun.runId}`
  });
  const restoredStageContext = ciRepairStageContext(queuedCiRepair.task);
  const stageContext =
    restoredStageContext ??
    buildInitialCiRepairStageContext({
      ciRepair,
      branchName,
      base,
      draft: input.options.draft === true,
      worker: input.options.worker,
      ...(input.options.provider === undefined
        ? {}
        : { provider: input.options.provider }),
      ...(input.options.model === undefined ? {} : { model: input.options.model }),
      ...(input.options.baseUrl === undefined ? {} : { baseUrl: input.options.baseUrl })
    });

  return {
    status: "ready",
    ciRepair,
    base,
    branchName,
    stageContext,
    ...(restoredStageContext === undefined ? {} : { restoredStageContext })
  };
}
