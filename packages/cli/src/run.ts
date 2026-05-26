import { resolve } from "node:path";

import type { Task } from "@runstead/core";

import {
  ciRepairPullRequestResumeRunId,
  isCiRepairPullRequestResumeTask,
  runCiRepairOrchestratorUnlocked,
  type CiRepairWorkerKind,
  type CiRepairGitRunner,
  type RunCiRepairOrchestratorOptions,
  type RunCiRepairOrchestratorResult
} from "./ci-repair-orchestrator.js";
import type { CodexAuthStatus } from "./codex-auth.js";
import type { CodexDirectTransport } from "./codex-direct-worker.js";
import type { GitHubCliRunner } from "./github-actions.js";
import {
  isLocalAgentTask,
  runLocalAgentTask,
  type RunLocalAgentTaskResult
} from "./local-agent.js";
import { withRunsteadManagerLock } from "./manager-lock.js";
import {
  defaultCiRepairWorker,
  resolveOptionalRunModelProvider
} from "./run-ci-repair-routing.js";
import {
  baseUrlFromCiRepairTask,
  ciRepairTaskRunId,
  isRunnableCiRepairTask,
  modelFromCiRepairTask,
  providerFromCiRepairTask,
  verifierCommandsFromCiRepairTask,
  workerFromCiRepairTask
} from "./run-ci-repair-task.js";
import {
  pickNextQueuedTask,
  RUN_ONCE_SUPPORTED_TASK_TYPES
} from "./run-task-picker.js";
import { blockTask } from "./tasks.js";
import {
  runTaskVerifiersUnlocked,
  type RunTaskVerifierCommandResult
} from "./verifier-runner.js";
import type { WorkerProcessRunner } from "./wrapped-worker.js";

export { formatRunOnceReport, runOnceExitCode } from "./run-report.js";
export { pickNextQueuedTask } from "./run-task-picker.js";

export interface RunOnceOptions {
  cwd?: string;
  authToken?: string;
  base?: string;
  draft?: boolean;
  worker?: CiRepairWorkerKind;
  provider?: string;
  model?: string;
  baseUrl?: string;
  allowedPaths?: string[];
  deniedPaths?: string[];
  githubRunner?: GitHubCliRunner;
  gitRunner?: CiRepairGitRunner;
  workerRunner?: WorkerProcessRunner;
  codexDirectTransport?: CodexDirectTransport;
  codexAuthStatus?: () => Promise<
    Pick<CodexAuthStatus, "loggedIn" | "accessTokenExpired">
  >;
  verifierRunner?: (
    options: Parameters<typeof runTaskVerifiersUnlocked>[0]
  ) => ReturnType<typeof runTaskVerifiersUnlocked>;
  ciRepairOrchestrator?: (
    options: RunCiRepairOrchestratorOptions
  ) => Promise<RunCiRepairOrchestratorResult>;
  now?: Date;
}

export type RunOnceResult = RunOnceNoTaskResult | RunOnceExecutedTaskResult;

export interface RunOnceNoTaskResult {
  cwd: string;
  ranTask: false;
  reason: "no_queued_task";
}

export interface RunOnceExecutedTaskResult {
  cwd: string;
  ranTask: true;
  task: Task;
  commandResults?: RunTaskVerifierCommandResult[];
  ciRepairResult?: RunCiRepairOrchestratorResult;
  localAgentResult?: RunLocalAgentTaskResult;
}

export async function runOnce(options: RunOnceOptions = {}): Promise<RunOnceResult> {
  const cwd = resolve(options.cwd ?? process.cwd());

  return withRunsteadManagerLock({ cwd }, async () => runOnceUnlocked(cwd, options));
}

export async function runOnceUnlocked(
  cwd: string,
  options: RunOnceOptions
): Promise<RunOnceResult> {
  const task = pickNextQueuedTask(cwd);

  if (task?.type === "run_local_verifiers") {
    const result = await runTaskVerifiersUnlocked({
      cwd,
      taskId: task.id
    });

    return {
      cwd,
      ranTask: true,
      task: result.task,
      commandResults: result.commandResults
    };
  }

  if (task !== undefined && isLocalAgentTask(task)) {
    const result = await runLocalAgentTask({
      cwd,
      taskId: task.id,
      ...(options.codexDirectTransport === undefined
        ? {}
        : { transport: options.codexDirectTransport }),
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return {
      cwd,
      ranTask: true,
      task: result.task,
      localAgentResult: result
    };
  }

  if (task !== undefined && isCiRepairPullRequestResumeTask(task)) {
    const runId = ciRepairPullRequestResumeRunId(task);

    if (runId === undefined) {
      throw new Error(`Task ${task.id} is not ready to resume CI repair`);
    }

    const modelProvider = await resolveOptionalRunModelProvider(cwd, {
      ...(options.provider === undefined ? {} : { provider: options.provider }),
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl })
    });
    const result = await runCiRepairOrchestratorUnlocked({
      cwd,
      runId,
      worker:
        options.worker ??
        (await defaultCiRepairWorker({
          options,
          modelProvider
        })),
      ...(modelProvider.provider === undefined
        ? {}
        : { provider: modelProvider.provider }),
      ...(modelProvider.model === undefined ? {} : { model: modelProvider.model }),
      ...(modelProvider.baseUrl === undefined
        ? {}
        : { baseUrl: modelProvider.baseUrl }),
      verifierCommands: [],
      ...(options.base === undefined ? {} : { base: options.base }),
      ...(options.draft === undefined ? {} : { draft: options.draft }),
      ...(options.allowedPaths === undefined
        ? {}
        : { allowedPaths: options.allowedPaths }),
      ...(options.deniedPaths === undefined
        ? {}
        : { deniedPaths: options.deniedPaths }),
      ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
      ...(options.githubRunner === undefined
        ? {}
        : { githubRunner: options.githubRunner }),
      ...(options.gitRunner === undefined ? {} : { gitRunner: options.gitRunner }),
      ...(options.workerRunner === undefined
        ? {}
        : { workerRunner: options.workerRunner }),
      ...(options.codexDirectTransport === undefined
        ? {}
        : { codexDirectTransport: options.codexDirectTransport }),
      ...(options.verifierRunner === undefined
        ? {}
        : { verifierRunner: options.verifierRunner }),
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return {
      cwd,
      ranTask: true,
      task: result.ciRepair.task,
      ciRepairResult: result
    };
  }

  if (task !== undefined && isRunnableCiRepairTask(task)) {
    const runId = ciRepairTaskRunId(task);

    if (runId === undefined) {
      throw new Error(`Task ${task.id} is missing a CI workflow run id`);
    }

    const requestedProvider = options.provider ?? providerFromCiRepairTask(task);
    const requestedModel = options.model ?? modelFromCiRepairTask(task);
    const requestedBaseUrl = options.baseUrl ?? baseUrlFromCiRepairTask(task);
    const modelProvider = await resolveOptionalRunModelProvider(cwd, {
      ...(requestedProvider === undefined ? {} : { provider: requestedProvider }),
      ...(requestedModel === undefined ? {} : { model: requestedModel }),
      ...(requestedBaseUrl === undefined ? {} : { baseUrl: requestedBaseUrl })
    });
    const worker =
      options.worker ??
      workerFromCiRepairTask(task) ??
      (await defaultCiRepairWorker({ options, modelProvider }));
    const result = await (
      options.ciRepairOrchestrator ?? runCiRepairOrchestratorUnlocked
    )({
      cwd,
      runId,
      worker,
      ...(modelProvider.provider === undefined
        ? {}
        : { provider: modelProvider.provider }),
      ...(modelProvider.model === undefined ? {} : { model: modelProvider.model }),
      ...(modelProvider.baseUrl === undefined
        ? {}
        : { baseUrl: modelProvider.baseUrl }),
      verifierCommands: verifierCommandsFromCiRepairTask(task),
      ...(options.base === undefined ? {} : { base: options.base }),
      ...(options.draft === undefined ? {} : { draft: options.draft }),
      ...(options.allowedPaths === undefined
        ? {}
        : { allowedPaths: options.allowedPaths }),
      ...(options.deniedPaths === undefined
        ? {}
        : { deniedPaths: options.deniedPaths }),
      ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
      ...(options.githubRunner === undefined
        ? {}
        : { githubRunner: options.githubRunner }),
      ...(options.gitRunner === undefined ? {} : { gitRunner: options.gitRunner }),
      ...(options.workerRunner === undefined
        ? {}
        : { workerRunner: options.workerRunner }),
      ...(options.codexDirectTransport === undefined
        ? {}
        : { codexDirectTransport: options.codexDirectTransport }),
      ...(options.verifierRunner === undefined
        ? {}
        : { verifierRunner: options.verifierRunner }),
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return {
      cwd,
      ranTask: true,
      task: result.ciRepair.task,
      ciRepairResult: result
    };
  }

  if (task?.type === "manual_review") {
    const blocked = blockTask({
      cwd,
      task,
      reason: "manual_review_required",
      output: {
        summary:
          "Manual review tasks require a human evidence attachment before automation can continue.",
        verifiers: task.verifiers
      },
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return {
      cwd,
      ranTask: true,
      task: blocked.task
    };
  }

  if (task !== undefined) {
    const blocked = blockTask({
      cwd,
      task,
      reason: "unsupported_task_type",
      output: {
        supportedTaskTypes: RUN_ONCE_SUPPORTED_TASK_TYPES
      },
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return {
      cwd,
      ranTask: true,
      task: blocked.task
    };
  }

  return {
    cwd,
    ranTask: false,
    reason: "no_queued_task"
  };
}
