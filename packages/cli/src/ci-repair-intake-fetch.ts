import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import {
  fetchGitHubWorkflowRunLog,
  getGitHubWorkflowRunStatus,
  type GitHubWorkflowRunLog,
  type GitHubWorkflowRunStatus
} from "./github-actions.js";
import { githubRunLogReadAction, githubRunReadAction } from "./ci-repair-actions.js";
import { classifyCiFailure } from "./ci-repair-classification.js";
import { CI_LOG_EVIDENCE_METADATA } from "./ci-repair-evidence.js";
import { redactGitHubWorkflowRunLog } from "./ci-repair-log-redaction.js";
import { runGovernedToolAction } from "./governed-action.js";
import type { PolicyProfile } from "./policy.js";
import type { CreateCiRepairTaskOptions } from "./ci-repair-types.js";

export interface FetchCiRepairWorkflowRunIntakeInput {
  cwd: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  task: Task;
  workerRun: WorkerRun;
  runId: string;
  authToken?: CreateCiRepairTaskOptions["authToken"];
  runner?: CreateCiRepairTaskOptions["runner"];
  now?: Date;
}

export interface CiRepairWorkflowRunIntake {
  workflowRun: GitHubWorkflowRunStatus;
  log: GitHubWorkflowRunLog;
  failureClassification: ReturnType<typeof classifyCiFailure>;
}

export async function fetchCiRepairWorkflowRunIntake(
  input: FetchCiRepairWorkflowRunIntakeInput
): Promise<CiRepairWorkflowRunIntake> {
  const [workflowRunResult, logResult] = await Promise.all([
    runGovernedToolAction({
      cwd: input.cwd,
      stateDb: input.stateDb,
      database: input.database,
      policy: input.policy,
      task: input.task,
      workerRun: input.workerRun,
      action: githubRunReadAction({
        task: input.task,
        cwd: input.cwd,
        runId: input.runId
      }),
      requestedBy: "runstead:ci-repair",
      ...(input.now === undefined ? {} : { now: input.now }),
      run: async () => {
        const value = await getGitHubWorkflowRunStatus({
          cwd: input.cwd,
          runId: input.runId,
          ...(input.authToken === undefined ? {} : { authToken: input.authToken }),
          ...(input.runner === undefined ? {} : { runner: input.runner })
        });

        return {
          value,
          output: {
            runId: value.runId,
            status: value.status,
            ...(value.conclusion === undefined ? {} : { conclusion: value.conclusion })
          }
        };
      }
    }),
    runGovernedToolAction({
      cwd: input.cwd,
      stateDb: input.stateDb,
      database: input.database,
      policy: input.policy,
      task: input.task,
      workerRun: input.workerRun,
      action: githubRunLogReadAction({
        task: input.task,
        cwd: input.cwd,
        runId: input.runId
      }),
      requestedBy: "runstead:ci-repair",
      ...(input.now === undefined ? {} : { now: input.now }),
      run: async () => {
        const value = await fetchGitHubWorkflowRunLog({
          cwd: input.cwd,
          runId: input.runId,
          ...(input.authToken === undefined ? {} : { authToken: input.authToken }),
          ...(input.runner === undefined ? {} : { runner: input.runner })
        });

        return {
          value,
          output: {
            runId: value.runId,
            byteLength: value.byteLength,
            trust: CI_LOG_EVIDENCE_METADATA.trust
          }
        };
      }
    })
  ]);
  const workflowRun = workflowRunResult.value;
  const log = redactGitHubWorkflowRunLog(logResult.value);

  return {
    workflowRun,
    log,
    failureClassification: classifyCiFailure(workflowRun, log)
  };
}
