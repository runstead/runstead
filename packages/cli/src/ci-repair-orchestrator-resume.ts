import { join } from "node:path";

import type { Evidence, Task } from "@runstead/core";
import { openRunsteadDatabase, type RunsteadDatabase } from "@runstead/state-sqlite";

import type { CreateCiRepairTaskResult } from "./ci-repair.js";
import {
  incrementCiRepairCounter,
  parsePullRequestResumeContext,
  pullRequestResumeContext,
  type CiRepairOrchestratorResumeContext
} from "./ci-repair-orchestrator-context.js";
import { publishCiRepairPullRequest } from "./ci-repair-orchestrator-publish-flow.js";
import { taskEvent } from "./ci-repair-orchestrator-task-state.js";
import { writeCiRepairContextPatch } from "./ci-repair-orchestrator-stage-persistence.js";
import type {
  CiRepairGitRunner,
  RunCiRepairOrchestratorResult
} from "./ci-repair-orchestrator-types.js";
import type { GitHubCliRunner, GitHubWorkflowRunLog } from "./github-actions.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { startWorkerRun } from "./runtime-audit.js";
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

    const publishResult = await publishCiRepairPullRequest({
      cwd: options.cwd,
      stateDb,
      database,
      policy,
      task: resumeTask,
      workerRun,
      ciRepair,
      context: resumeContext,
      deniedAction: "mark_blocked",
      ...(options.gitRunner === undefined ? {} : { gitRunner: options.gitRunner }),
      ...(options.githubRunner === undefined
        ? {}
        : { githubRunner: options.githubRunner }),
      ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
      ...(options.onStagePersisted === undefined
        ? {}
        : { onStagePersisted: options.onStagePersisted }),
      ...(options.now === undefined ? {} : { now: options.now })
    });

    if (publishResult.status === "waiting_approval") {
      return {
        status: "waiting_approval",
        ciRepair: {
          ...ciRepair,
          task: publishResult.task
        },
        branchName: context.branchName,
        workerResult: context.workerResult,
        ...(context.commit === undefined ? {} : { commit: context.commit }),
        diffScope: context.diffScope,
        verifierResult: {
          task: publishResult.task,
          commandResults: context.verifierCommandResults
        },
        approval: publishResult.approval
      };
    }

    return {
      status: "completed",
      ciRepair: {
        ...ciRepair,
        task: publishResult.task
      },
      branchName: context.branchName,
      workerResult: context.workerResult,
      ...(context.commit === undefined ? {} : { commit: context.commit }),
      diffScope: context.diffScope,
      verifierResult: {
        task: publishResult.task,
        commandResults: context.verifierCommandResults
      },
      pullRequest: publishResult.pullRequest
    };
  } finally {
    database.close();
  }
}
