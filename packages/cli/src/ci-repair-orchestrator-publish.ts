import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { CreateCiRepairTaskResult } from "./ci-repair.js";
import {
  githubPullRequestCreateAction,
  gitPushAction,
  repairPublishAction
} from "./ci-repair-orchestrator-actions.js";
import type {
  CiRepairOrchestratorResumeContext,
  PublishCoverage
} from "./ci-repair-orchestrator-context.js";
import { pullRequestOutput } from "./ci-repair-orchestrator-output.js";
import { runPublishCoveredToolAction } from "./ci-repair-orchestrator-publish-covered-action.js";
import { buildCiRepairPullRequestBody } from "./ci-repair-orchestrator-pr-body.js";
import { readCiRepairPullRequestAuditSummary } from "./ci-repair-orchestrator-pr-audit.js";
import type { CiRepairGitRunner } from "./ci-repair-orchestrator-types.js";
import type { GitHubCliRunner } from "./github-actions.js";
import {
  createGitHubPullRequest,
  type CreateGitHubPullRequestResult
} from "./github-pr.js";
import { runGovernedToolAction } from "./governed-action.js";
import { pushGitBranch } from "./git-branch.js";
import type { PolicyProfile } from "./policy.js";

export async function ensureGovernedRepairPublishApproval(options: {
  cwd: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  task: Task;
  workerRun: WorkerRun;
  context: CiRepairOrchestratorResumeContext;
  now?: Date;
}): Promise<PublishCoverage> {
  const result = await runGovernedToolAction({
    cwd: options.cwd,
    stateDb: options.stateDb,
    database: options.database,
    policy: options.policy,
    task: options.task,
    workerRun: options.workerRun,
    action: repairPublishAction({
      actionId: options.context.publishActionId,
      branchName: options.context.branchName,
      base: options.context.base,
      draft: options.context.draft
    }),
    requestedBy: "runstead:ci-repair",
    ...(options.now === undefined ? {} : { now: options.now }),
    run: () =>
      Promise.resolve({
        value: undefined,
        output: {
          branchName: options.context.branchName,
          base: options.context.base,
          draft: options.context.draft,
          includes: ["git.push", "github.pr.create"]
        }
      })
  });

  return {
    toolCallId: result.toolCall.id,
    policyDecisionId: result.policyDecision.id,
    ...(result.approval === undefined
      ? options.context.approvalId === undefined
        ? {}
        : { approvalId: options.context.approvalId }
      : { approvalId: result.approval.id })
  };
}

export async function pushRepairBranchWithPublishApproval(options: {
  cwd: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  task: Task;
  workerRun: WorkerRun;
  context: CiRepairOrchestratorResumeContext;
  coverage?: PublishCoverage;
  approvalId?: string;
  gitRunner?: CiRepairGitRunner;
  now?: Date;
}): Promise<void> {
  await runPublishCoveredToolAction({
    cwd: options.cwd,
    stateDb: options.stateDb,
    database: options.database,
    policy: options.policy,
    task: options.task,
    workerRun: options.workerRun,
    action: gitPushAction({
      task: options.task,
      actionId: options.context.pushActionId,
      branchName: options.context.branchName,
      base: options.context.base
    }),
    ...(options.coverage === undefined ? {} : { coverage: options.coverage }),
    ...(options.approvalId === undefined ? {} : { approvalId: options.approvalId }),
    ...(options.now === undefined ? {} : { now: options.now }),
    run: async () => {
      const value = await pushGitBranch({
        cwd: options.cwd,
        branchName: options.context.branchName,
        ...(options.gitRunner === undefined ? {} : { runner: options.gitRunner })
      });

      return {
        value,
        output: {
          branchName: value.branchName,
          remote: value.remote
        }
      };
    }
  });
}

export async function createRepairPullRequestWithPublishApproval(options: {
  cwd: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  task: Task;
  workerRun: WorkerRun;
  ciRepair: CreateCiRepairTaskResult;
  context: CiRepairOrchestratorResumeContext;
  coverage?: PublishCoverage;
  approvalId?: string;
  authToken?: string;
  githubRunner?: GitHubCliRunner;
  now?: Date;
}): Promise<CreateGitHubPullRequestResult> {
  const title = `Repair CI run ${options.ciRepair.workflowRun.runId}`;

  return runPublishCoveredToolAction({
    cwd: options.cwd,
    stateDb: options.stateDb,
    database: options.database,
    policy: options.policy,
    task: options.task,
    workerRun: options.workerRun,
    action: githubPullRequestCreateAction({
      task: options.task,
      actionId: options.context.prActionId,
      title,
      base: options.context.base,
      head: options.context.branchName
    }),
    ...(options.coverage === undefined ? {} : { coverage: options.coverage }),
    ...(options.approvalId === undefined ? {} : { approvalId: options.approvalId }),
    ...(options.now === undefined ? {} : { now: options.now }),
    run: async () => {
      const auditSummary = readCiRepairPullRequestAuditSummary(
        options.database,
        options.task.id
      );
      const value = await createGitHubPullRequest({
        cwd: options.cwd,
        title,
        body: buildCiRepairPullRequestBody(
          options.ciRepair,
          options.task,
          auditSummary
        ),
        base: options.context.base,
        head: options.context.branchName,
        draft: options.context.draft,
        taskId: options.task.id,
        goalId: options.task.goalId,
        evidence: [
          {
            id: options.ciRepair.evidence.id,
            type: options.ciRepair.evidence.type,
            summary:
              options.ciRepair.evidence.summary ?? "GitHub workflow run evidence",
            uri: options.ciRepair.evidence.uri
          }
        ],
        ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
        ...(options.githubRunner === undefined ? {} : { runner: options.githubRunner })
      });

      return {
        value,
        output: pullRequestOutput(value)
      };
    }
  });
}
