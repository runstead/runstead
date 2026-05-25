import { join } from "node:path";

import type { Evidence, Task } from "@runstead/core";
import { openRunsteadDatabase, type RunsteadDatabase } from "@runstead/state-sqlite";

import type { CreateCiRepairTaskResult } from "./ci-repair.js";
import {
  ciRepairApprovalSummary,
  ciRepairPublishApprovalStage
} from "./ci-repair-orchestrator-approval.js";
import {
  incrementCiRepairCounter,
  parsePullRequestResumeContext,
  publishCoverageFromContext,
  publishCoverageStagePatch,
  pullRequestResumeContext,
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
  taskEvent,
  writeTaskOutput
} from "./ci-repair-orchestrator-task-state.js";
import {
  writeCiRepairContextPatch,
  writeCiRepairStage
} from "./ci-repair-orchestrator-stage-persistence.js";
import type {
  CiRepairGitRunner,
  RunCiRepairOrchestratorResult
} from "./ci-repair-orchestrator-types.js";
import type { GitHubCliRunner, GitHubWorkflowRunLog } from "./github-actions.js";
import {
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "./governed-action.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { finishWorkerRun, startWorkerRun } from "./runtime-audit.js";
import { claimTask, listTasks } from "./tasks.js";

export function findPullRequestResumeTask(options: {
  cwd: string;
  runId: string;
}): Task | undefined {
  return listTasks({ cwd: options.cwd }).tasks.find((task) => {
    if (task.domain !== "repo-maintenance" || task.type !== "ci_repair") {
      return false;
    }

    if (task.status !== "queued") {
      return false;
    }

    if (String(task.input.runId) !== options.runId) {
      return false;
    }

    return pullRequestResumeContext(task) !== undefined;
  });
}

export function isCiRepairPullRequestResumeTask(task: Task): boolean {
  return (
    task.domain === "repo-maintenance" &&
    task.type === "ci_repair" &&
    task.status === "queued" &&
    pullRequestResumeContext(task) !== undefined
  );
}

export function ciRepairPullRequestResumeRunId(task: Task): string | undefined {
  return pullRequestResumeContext(task)?.runId;
}

export function assertNoRunningCiRepairOrchestratorWorker(input: {
  database: RunsteadDatabase;
  task: Task;
}): void {
  const row = input.database
    .prepare(
      `
      SELECT id
      FROM worker_runs
      WHERE task_id = ? AND worker_type = 'ci_repair_orchestrator' AND status = 'running'
      ORDER BY started_at DESC, id ASC
      LIMIT 1
    `
    )
    .get(input.task.id) as { id: string } | undefined;

  if (row !== undefined) {
    throw new Error(
      `CI repair task ${input.task.id} already has a running CI repair orchestrator: ${row.id}`
    );
  }
}

export function ciRepairResultFromResume(input: {
  cwd: string;
  stateDb: string;
  task: Task;
  context: CiRepairOrchestratorResumeContext;
}): CreateCiRepairTaskResult {
  const evidence: Evidence = {
    id: input.context.evidence.id,
    type: input.context.evidence.type,
    subjectType: input.context.evidence.subjectType,
    subjectId: input.context.evidence.subjectId,
    uri: input.context.evidence.uri,
    ...(input.context.evidence.hash === undefined
      ? {}
      : { hash: input.context.evidence.hash }),
    ...(input.context.evidence.summary === undefined
      ? {}
      : { summary: input.context.evidence.summary }),
    createdAt: input.context.evidence.createdAt
  };

  return {
    status: "created",
    cwd: input.cwd,
    stateDb: input.stateDb,
    task: input.task,
    event: taskEvent(
      "task.resumed",
      input.task,
      {
        runId: input.context.runId,
        stage: input.context.stage
      },
      input.task.updatedAt || input.task.createdAt
    ),
    evidence,
    evidencePath: evidence.uri,
    workflowRun: input.context.workflowRun,
    log: {
      runId: input.context.runId,
      log: "",
      byteLength: 0
    } satisfies GitHubWorkflowRunLog,
    created: false
  };
}

export async function resumeCiRepairPullRequest(options: {
  cwd: string;
  root: string;
  task: Task;
  authToken?: string;
  githubRunner?: GitHubCliRunner;
  gitRunner?: CiRepairGitRunner;
  onStagePersisted?: (stage: string, task: Task) => void;
  now?: Date;
}): Promise<RunCiRepairOrchestratorResult> {
  const task =
    options.task.status === "queued"
      ? claimTask({
          cwd: options.cwd,
          id: options.task.id,
          ...(options.now === undefined ? {} : { now: options.now })
        }).task
      : options.task;
  const context = parsePullRequestResumeContext(task);
  const stateDb = join(options.root, "state.db");
  const policy = await loadPolicyProfileFromFile(
    join(options.root, "policies", "repo-maintenance.yaml")
  );
  const database = openRunsteadDatabase(stateDb);
  const ciRepair = ciRepairResultFromResume({
    cwd: options.cwd,
    stateDb,
    task,
    context
  });

  try {
    assertNoRunningCiRepairOrchestratorWorker({
      database,
      task
    });

    const workerRun = startWorkerRun({
      database,
      task,
      workerType: "ci_repair_orchestrator",
      enforcementLevel: "policy_enforced",
      ...(options.now === undefined ? {} : { now: options.now })
    });

    let resumeTask = task;
    let resumeContext = context;

    ({ task: resumeTask, context: resumeContext } = writeCiRepairContextPatch({
      database,
      task: resumeTask,
      context: resumeContext,
      patch: {
        counters: incrementCiRepairCounter(resumeContext, "orchestratorAttempt")
      },
      ...(options.now === undefined ? {} : { now: options.now })
    }) as {
      task: Task;
      context: CiRepairOrchestratorResumeContext;
    });

    try {
      if (!stageAtLeast(resumeContext.stage, "branch_pushed")) {
        let publishCoverage = publishCoverageFromContext(resumeContext);

        if (
          !stageAtLeast(resumeContext.stage, "publish_approved") ||
          publishCoverage === undefined
        ) {
          publishCoverage = await ensureGovernedRepairPublishApproval({
            cwd: options.cwd,
            stateDb,
            database,
            policy,
            task: resumeTask,
            workerRun,
            context: resumeContext,
            ...(options.now === undefined ? {} : { now: options.now })
          });
          resumeContext = {
            ...resumeContext,
            counters: incrementCiRepairCounter(resumeContext, "publishAttempt")
          };
          ({ task: resumeTask, context: resumeContext } = writeCiRepairStage({
            database,
            task: resumeTask,
            context: resumeContext,
            stage: "publish_approved",
            patch: publishCoverageStagePatch(publishCoverage),
            ...(options.onStagePersisted === undefined
              ? {}
              : { onStagePersisted: options.onStagePersisted }),
            ...(options.now === undefined ? {} : { now: options.now })
          }) as {
            task: Task;
            context: CiRepairOrchestratorResumeContext;
          });
        }
        await pushRepairBranchWithPublishApproval({
          cwd: options.cwd,
          stateDb,
          database,
          policy,
          task: resumeTask,
          workerRun,
          context: resumeContext,
          coverage: publishCoverage,
          ...(resumeContext.approvalId === undefined
            ? {}
            : { approvalId: resumeContext.approvalId }),
          ...(options.gitRunner === undefined ? {} : { gitRunner: options.gitRunner }),
          ...(options.now === undefined ? {} : { now: options.now })
        });
        ({ task: resumeTask, context: resumeContext } = writeCiRepairStage({
          database,
          task: resumeTask,
          context: resumeContext,
          stage: "branch_pushed",
          patch: {
            branchPushed: true,
            ...publishCoverageStagePatch(publishCoverage)
          },
          ...(options.onStagePersisted === undefined
            ? {}
            : { onStagePersisted: options.onStagePersisted }),
          ...(options.now === undefined ? {} : { now: options.now })
        }) as {
          task: Task;
          context: CiRepairOrchestratorResumeContext;
        });
      }

      const publishCoverage = publishCoverageFromContext(resumeContext);
      const pullRequest = await createRepairPullRequestWithPublishApproval({
        cwd: options.cwd,
        stateDb,
        database,
        policy,
        task: resumeTask,
        workerRun,
        ciRepair,
        context: resumeContext,
        ...(publishCoverage === undefined ? {} : { coverage: publishCoverage }),
        ...(resumeContext.approvalId === undefined
          ? {}
          : { approvalId: resumeContext.approvalId }),
        ...(options.githubRunner === undefined
          ? {}
          : { githubRunner: options.githubRunner }),
        ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
        ...(options.now === undefined ? {} : { now: options.now })
      });
      const completedTask = writeTaskOutput({
        database,
        task: resumeTask,
        status: "completed",
        output: {
          ...(resumeTask.output ?? {}),
          ciRepairOrchestrator: {
            ...resumeContext,
            stage: "completed",
            pullRequest
          }
        },
        eventType: "task.completed",
        ...(options.now === undefined ? {} : { now: options.now })
      });

      finishWorkerRun({
        database,
        workerRun,
        status: "completed",
        output: {
          pullRequest: pullRequestOutput(pullRequest)
        },
        ...(options.now === undefined ? {} : { now: options.now })
      });

      return {
        status: "completed",
        ciRepair: {
          ...ciRepair,
          task: completedTask
        },
        branchName: context.branchName,
        workerResult: context.workerResult,
        ...(context.commit === undefined ? {} : { commit: context.commit }),
        diffScope: context.diffScope,
        verifierResult: {
          task: completedTask,
          commandResults: context.verifierCommandResults
        },
        pullRequest
      };
    } catch (error) {
      if (isStagePersistenceInterruption(error)) {
        throw error;
      }

      if (error instanceof ToolActionApprovalRequiredError) {
        const approvalStage = ciRepairPublishApprovalStage(error.toolCall.actionType);
        const waitingContext = {
          ...resumeContext,
          counters: incrementCiRepairCounter(resumeContext, "approvalRound")
        };
        const waitingTask = markTaskTerminal({
          database,
          task: resumeTask,
          status: "waiting_approval",
          output: {
            ...(resumeTask.output ?? {}),
            ciRepairOrchestrator: {
              ...waitingContext,
              stage: approvalStage,
              approvalId: error.approval.id
            }
          },
          ...(options.now === undefined ? {} : { now: options.now })
        });
        finishWorkerRun({
          database,
          workerRun,
          status: "waiting_approval",
          output: {
            approvalId: error.approval.id,
            actionType: error.toolCall.actionType
          },
          ...(options.now === undefined ? {} : { now: options.now })
        });

        return {
          status: "waiting_approval",
          ciRepair: {
            ...ciRepair,
            task: waitingTask
          },
          branchName: context.branchName,
          workerResult: context.workerResult,
          ...(context.commit === undefined ? {} : { commit: context.commit }),
          diffScope: context.diffScope,
          verifierResult: {
            task: waitingTask,
            commandResults: context.verifierCommandResults
          },
          approval: ciRepairApprovalSummary(error)
        };
      }

      if (error instanceof ToolActionDeniedError) {
        markTaskTerminal({
          database,
          task: resumeTask,
          status: "blocked",
          output: {
            summary: error.message,
            policyDecisionId: error.policyDecision.id
          },
          ...(options.now === undefined ? {} : { now: options.now })
        });
        finishWorkerRun({
          database,
          workerRun,
          status: "blocked",
          output: {
            error: error.message,
            policyDecisionId: error.policyDecision.id
          },
          ...(options.now === undefined ? {} : { now: options.now })
        });

        throw error;
      }

      failCiRepairOrchestratorRun({
        database,
        task: resumeTask,
        workerRun,
        summary: "CI repair publish failed",
        error,
        ...(options.now === undefined ? {} : { now: options.now })
      });

      throw error;
    }
  } finally {
    database.close();
  }
}
