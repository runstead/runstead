import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { CreateCiRepairTaskResult } from "./ci-repair.js";
import {
  incrementCiRepairCounter,
  publishCoverageFromContext,
  publishCoverageStagePatch,
  stageAtLeast,
  type CiRepairOrchestratorResumeContext
} from "./ci-repair-orchestrator-context.js";
import { completeCiRepairPublish } from "./ci-repair-orchestrator-publish-completion.js";
import {
  markCiRepairPublishDenied,
  waitForCiRepairPublishApproval
} from "./ci-repair-orchestrator-publish-errors.js";
import {
  createRepairPullRequestWithPublishApproval,
  ensureGovernedRepairPublishApproval,
  pushRepairBranchWithPublishApproval
} from "./ci-repair-orchestrator-publish.js";
import {
  failCiRepairOrchestratorRun,
  isStagePersistenceInterruption
} from "./ci-repair-orchestrator-task-state.js";
import { writeCiRepairStage } from "./ci-repair-orchestrator-stage-persistence.js";
import type { CiRepairGitRunner } from "./ci-repair-orchestrator-types.js";
import type { GitHubCliRunner } from "./github-actions.js";
import {
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "./governed-action.js";
import type { CreateGitHubPullRequestResult } from "./github-pr.js";
import type { PolicyProfile } from "./policy.js";

export interface PublishCiRepairPullRequestInput {
  cwd: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  task: Task;
  workerRun: WorkerRun;
  ciRepair: CreateCiRepairTaskResult;
  context: CiRepairOrchestratorResumeContext;
  authToken?: string;
  githubRunner?: GitHubCliRunner;
  gitRunner?: CiRepairGitRunner;
  onStagePersisted?: (stage: string, task: Task) => void;
  deniedAction?: "throw" | "mark_blocked";
  now?: Date;
}

export type PublishCiRepairPullRequestResult =
  | {
      status: "completed";
      task: Task;
      context: CiRepairOrchestratorResumeContext;
      pullRequest: CreateGitHubPullRequestResult;
    }
  | {
      status: "waiting_approval";
      task: Task;
      context: CiRepairOrchestratorResumeContext;
      approval: {
        id: string;
        actionId: string;
        policyDecisionId: string;
        reason: string;
      };
    };

export async function publishCiRepairPullRequest(
  input: PublishCiRepairPullRequestInput
): Promise<PublishCiRepairPullRequestResult> {
  let publishTask = input.task;
  let publishContext = input.context;

  try {
    if (!stageAtLeast(publishContext.stage, "branch_pushed")) {
      let publishCoverage = publishCoverageFromContext(publishContext);

      if (
        !stageAtLeast(publishContext.stage, "publish_approved") ||
        publishCoverage === undefined
      ) {
        publishCoverage = await ensureGovernedRepairPublishApproval({
          cwd: input.cwd,
          stateDb: input.stateDb,
          database: input.database,
          policy: input.policy,
          task: publishTask,
          workerRun: input.workerRun,
          context: publishContext,
          ...(input.now === undefined ? {} : { now: input.now })
        });
        publishContext = {
          ...publishContext,
          counters: incrementCiRepairCounter(publishContext, "publishAttempt")
        };
        ({ task: publishTask, context: publishContext } = writeCiRepairStage({
          database: input.database,
          task: publishTask,
          context: publishContext,
          stage: "publish_approved",
          patch: publishCoverageStagePatch(publishCoverage),
          ...(input.onStagePersisted === undefined
            ? {}
            : { onStagePersisted: input.onStagePersisted }),
          ...(input.now === undefined ? {} : { now: input.now })
        }) as {
          task: Task;
          context: CiRepairOrchestratorResumeContext;
        });
      }
      await pushRepairBranchWithPublishApproval({
        cwd: input.cwd,
        stateDb: input.stateDb,
        database: input.database,
        policy: input.policy,
        task: publishTask,
        workerRun: input.workerRun,
        context: publishContext,
        coverage: publishCoverage,
        ...(publishContext.approvalId === undefined
          ? {}
          : { approvalId: publishContext.approvalId }),
        ...(input.gitRunner === undefined ? {} : { gitRunner: input.gitRunner }),
        ...(input.now === undefined ? {} : { now: input.now })
      });
      ({ task: publishTask, context: publishContext } = writeCiRepairStage({
        database: input.database,
        task: publishTask,
        context: publishContext,
        stage: "branch_pushed",
        patch: {
          branchPushed: true,
          ...publishCoverageStagePatch(publishCoverage)
        },
        ...(input.onStagePersisted === undefined
          ? {}
          : { onStagePersisted: input.onStagePersisted }),
        ...(input.now === undefined ? {} : { now: input.now })
      }) as {
        task: Task;
        context: CiRepairOrchestratorResumeContext;
      });
    }

    const publishCoverage = publishCoverageFromContext(publishContext);
    const pullRequest = await createRepairPullRequestWithPublishApproval({
      cwd: input.cwd,
      stateDb: input.stateDb,
      database: input.database,
      policy: input.policy,
      task: publishTask,
      workerRun: input.workerRun,
      ciRepair: input.ciRepair,
      context: publishContext,
      ...(publishCoverage === undefined ? {} : { coverage: publishCoverage }),
      ...(publishContext.approvalId === undefined
        ? {}
        : { approvalId: publishContext.approvalId }),
      ...(input.githubRunner === undefined ? {} : { githubRunner: input.githubRunner }),
      ...(input.authToken === undefined ? {} : { authToken: input.authToken }),
      ...(input.now === undefined ? {} : { now: input.now })
    });
    return completeCiRepairPublish({
      database: input.database,
      task: publishTask,
      workerRun: input.workerRun,
      context: publishContext,
      pullRequest,
      ...(input.now === undefined ? {} : { now: input.now })
    });
  } catch (error) {
    if (isStagePersistenceInterruption(error)) {
      throw error;
    }

    if (error instanceof ToolActionApprovalRequiredError) {
      return waitForCiRepairPublishApproval({
        database: input.database,
        task: publishTask,
        workerRun: input.workerRun,
        context: publishContext,
        error,
        ...(input.now === undefined ? {} : { now: input.now })
      });
    }

    if (error instanceof ToolActionDeniedError) {
      if (input.deniedAction === "mark_blocked") {
        markCiRepairPublishDenied({
          database: input.database,
          task: publishTask,
          workerRun: input.workerRun,
          error,
          ...(input.now === undefined ? {} : { now: input.now })
        });
      }

      throw error;
    }

    failCiRepairOrchestratorRun({
      database: input.database,
      task: publishTask,
      workerRun: input.workerRun,
      summary: "CI repair publish failed",
      error,
      ...(input.now === undefined ? {} : { now: input.now })
    });

    throw error;
  }
}
