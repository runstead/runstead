import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { CreateCiRepairTaskResult } from "./ci-repair.js";
import {
  ciRepairApprovalSummary,
  ciRepairPublishApprovalStage
} from "./ci-repair-orchestrator-approval.js";
import {
  incrementCiRepairCounter,
  publishCoverageFromContext,
  publishCoverageStagePatch,
  stageAtLeast,
  type CiRepairOrchestratorResumeContext
} from "./ci-repair-orchestrator-context.js";
import { pullRequestOutput } from "./ci-repair-orchestrator-output.js";
import {
  createRepairPullRequestWithPublishApproval,
  ensureGovernedRepairPublishApproval,
  pushRepairBranchWithPublishApproval
} from "./ci-repair-orchestrator-publish.js";
import {
  failCiRepairOrchestratorRun,
  isStagePersistenceInterruption,
  markTaskTerminal,
  writeTaskOutput
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
import { finishWorkerRun } from "./runtime-audit.js";

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
    const completedTask = writeTaskOutput({
      database: input.database,
      task: publishTask,
      status: "completed",
      output: {
        ...(publishTask.output ?? {}),
        ciRepairOrchestrator: {
          ...publishContext,
          stage: "completed",
          pullRequest
        }
      },
      eventType: "task.completed",
      ...(input.now === undefined ? {} : { now: input.now })
    });

    finishWorkerRun({
      database: input.database,
      workerRun: input.workerRun,
      status: "completed",
      output: {
        pullRequest: pullRequestOutput(pullRequest)
      },
      ...(input.now === undefined ? {} : { now: input.now })
    });

    return {
      status: "completed",
      task: completedTask,
      context: publishContext,
      pullRequest
    };
  } catch (error) {
    if (isStagePersistenceInterruption(error)) {
      throw error;
    }

    if (error instanceof ToolActionApprovalRequiredError) {
      const approvalStage = ciRepairPublishApprovalStage(error.toolCall.actionType);
      const waitingContext = {
        ...publishContext,
        counters: incrementCiRepairCounter(publishContext, "approvalRound")
      };
      const waitingTask = markTaskTerminal({
        database: input.database,
        task: publishTask,
        status: "waiting_approval",
        output: {
          ...(publishTask.output ?? {}),
          ciRepairOrchestrator: {
            ...waitingContext,
            stage: approvalStage,
            approvalId: error.approval.id
          }
        },
        ...(input.now === undefined ? {} : { now: input.now })
      });
      finishWorkerRun({
        database: input.database,
        workerRun: input.workerRun,
        status: "waiting_approval",
        output: {
          approvalId: error.approval.id,
          actionType: error.toolCall.actionType
        },
        ...(input.now === undefined ? {} : { now: input.now })
      });

      return {
        status: "waiting_approval",
        task: waitingTask,
        context: waitingContext,
        approval: ciRepairApprovalSummary(error)
      };
    }

    if (error instanceof ToolActionDeniedError) {
      if (input.deniedAction === "mark_blocked") {
        markTaskTerminal({
          database: input.database,
          task: publishTask,
          status: "blocked",
          output: {
            summary: error.message,
            policyDecisionId: error.policyDecision.id
          },
          ...(input.now === undefined ? {} : { now: input.now })
        });
        finishWorkerRun({
          database: input.database,
          workerRun: input.workerRun,
          status: "blocked",
          output: {
            error: error.message,
            policyDecisionId: error.policyDecision.id
          },
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
