import type { Task } from "@runstead/core";

import {
  ciRepairPullRequestResumeRunId,
  runCiRepairOrchestratorUnlocked
} from "./ci-repair-orchestrator.js";
import {
  defaultCiRepairWorker,
  resolveOptionalRunModelProvider
} from "./run-ci-repair-routing.js";
import {
  baseUrlFromCiRepairTask,
  ciRepairTaskRunId,
  modelFromCiRepairTask,
  providerFromCiRepairTask,
  verifierCommandsFromCiRepairTask,
  workerFromCiRepairTask
} from "./run-ci-repair-task.js";
import type { RunOnceExecutedTaskResult, RunOnceOptions } from "./run-types.js";

export async function runCiRepairPullRequestResumeTask(input: {
  cwd: string;
  task: Task;
  options: RunOnceOptions;
}): Promise<RunOnceExecutedTaskResult> {
  const runId = ciRepairPullRequestResumeRunId(input.task);

  if (runId === undefined) {
    throw new Error(`Task ${input.task.id} is not ready to resume CI repair`);
  }

  const modelProvider = await resolveOptionalRunModelProvider(input.cwd, {
    ...(input.options.provider === undefined
      ? {}
      : { provider: input.options.provider }),
    ...(input.options.model === undefined ? {} : { model: input.options.model }),
    ...(input.options.baseUrl === undefined ? {} : { baseUrl: input.options.baseUrl })
  });
  const result = await runCiRepairOrchestratorUnlocked({
    cwd: input.cwd,
    runId,
    worker:
      input.options.worker ??
      (await defaultCiRepairWorker({
        options: input.options,
        modelProvider
      })),
    ...(modelProvider.provider === undefined
      ? {}
      : { provider: modelProvider.provider }),
    ...(modelProvider.model === undefined ? {} : { model: modelProvider.model }),
    ...(modelProvider.baseUrl === undefined ? {} : { baseUrl: modelProvider.baseUrl }),
    verifierCommands: [],
    ...(input.options.base === undefined ? {} : { base: input.options.base }),
    ...(input.options.draft === undefined ? {} : { draft: input.options.draft }),
    ...(input.options.allowedPaths === undefined
      ? {}
      : { allowedPaths: input.options.allowedPaths }),
    ...(input.options.deniedPaths === undefined
      ? {}
      : { deniedPaths: input.options.deniedPaths }),
    ...(input.options.authToken === undefined
      ? {}
      : { authToken: input.options.authToken }),
    ...(input.options.githubRunner === undefined
      ? {}
      : { githubRunner: input.options.githubRunner }),
    ...(input.options.gitRunner === undefined
      ? {}
      : { gitRunner: input.options.gitRunner }),
    ...(input.options.workerRunner === undefined
      ? {}
      : { workerRunner: input.options.workerRunner }),
    ...(input.options.codexDirectTransport === undefined
      ? {}
      : { codexDirectTransport: input.options.codexDirectTransport }),
    ...(input.options.verifierRunner === undefined
      ? {}
      : { verifierRunner: input.options.verifierRunner }),
    ...(input.options.now === undefined ? {} : { now: input.options.now })
  });

  return {
    cwd: input.cwd,
    ranTask: true,
    task: result.ciRepair.task,
    ciRepairResult: result
  };
}

export async function runRunnableCiRepairTask(input: {
  cwd: string;
  task: Task;
  options: RunOnceOptions;
}): Promise<RunOnceExecutedTaskResult> {
  const runId = ciRepairTaskRunId(input.task);

  if (runId === undefined) {
    throw new Error(`Task ${input.task.id} is missing a CI workflow run id`);
  }

  const requestedProvider =
    input.options.provider ?? providerFromCiRepairTask(input.task);
  const requestedModel = input.options.model ?? modelFromCiRepairTask(input.task);
  const requestedBaseUrl = input.options.baseUrl ?? baseUrlFromCiRepairTask(input.task);
  const modelProvider = await resolveOptionalRunModelProvider(input.cwd, {
    ...(requestedProvider === undefined ? {} : { provider: requestedProvider }),
    ...(requestedModel === undefined ? {} : { model: requestedModel }),
    ...(requestedBaseUrl === undefined ? {} : { baseUrl: requestedBaseUrl })
  });
  const worker =
    input.options.worker ??
    workerFromCiRepairTask(input.task) ??
    (await defaultCiRepairWorker({ options: input.options, modelProvider }));
  const result = await (
    input.options.ciRepairOrchestrator ?? runCiRepairOrchestratorUnlocked
  )({
    cwd: input.cwd,
    runId,
    worker,
    ...(modelProvider.provider === undefined
      ? {}
      : { provider: modelProvider.provider }),
    ...(modelProvider.model === undefined ? {} : { model: modelProvider.model }),
    ...(modelProvider.baseUrl === undefined ? {} : { baseUrl: modelProvider.baseUrl }),
    verifierCommands: verifierCommandsFromCiRepairTask(input.task),
    ...(input.options.base === undefined ? {} : { base: input.options.base }),
    ...(input.options.draft === undefined ? {} : { draft: input.options.draft }),
    ...(input.options.allowedPaths === undefined
      ? {}
      : { allowedPaths: input.options.allowedPaths }),
    ...(input.options.deniedPaths === undefined
      ? {}
      : { deniedPaths: input.options.deniedPaths }),
    ...(input.options.authToken === undefined
      ? {}
      : { authToken: input.options.authToken }),
    ...(input.options.githubRunner === undefined
      ? {}
      : { githubRunner: input.options.githubRunner }),
    ...(input.options.gitRunner === undefined
      ? {}
      : { gitRunner: input.options.gitRunner }),
    ...(input.options.workerRunner === undefined
      ? {}
      : { workerRunner: input.options.workerRunner }),
    ...(input.options.codexDirectTransport === undefined
      ? {}
      : { codexDirectTransport: input.options.codexDirectTransport }),
    ...(input.options.verifierRunner === undefined
      ? {}
      : { verifierRunner: input.options.verifierRunner }),
    ...(input.options.now === undefined ? {} : { now: input.options.now })
  });

  return {
    cwd: input.cwd,
    ranTask: true,
    task: result.ciRepair.task,
    ciRepairResult: result
  };
}
