import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { CiRepairOrchestratorResumeContext } from "./ci-repair-orchestrator-context.js";
import { pullRequestOutput } from "./ci-repair-orchestrator-output.js";
import { writeTaskOutput } from "./ci-repair-orchestrator-task-state.js";
import type { CreateGitHubPullRequestResult } from "./github-pr.js";
import { finishWorkerRun } from "./runtime-audit.js";

export function completeCiRepairPublish(input: {
  database: RunsteadDatabase;
  task: Task;
  workerRun: WorkerRun;
  context: CiRepairOrchestratorResumeContext;
  pullRequest: CreateGitHubPullRequestResult;
  now?: Date;
}) {
  const completedTask = writeTaskOutput({
    database: input.database,
    task: input.task,
    status: "completed",
    output: {
      ...(input.task.output ?? {}),
      ciRepairOrchestrator: {
        ...input.context,
        stage: "completed",
        pullRequest: input.pullRequest
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
      pullRequest: pullRequestOutput(input.pullRequest)
    },
    ...(input.now === undefined ? {} : { now: input.now })
  });

  return {
    status: "completed" as const,
    task: completedTask,
    context: input.context,
    pullRequest: input.pullRequest
  };
}
