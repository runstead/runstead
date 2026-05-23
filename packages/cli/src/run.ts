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
import { getCodexAuthStatus, type CodexAuthStatus } from "./codex-auth.js";
import type { CodexDirectTransport } from "./codex-direct-worker.js";
import type { GitHubCliRunner } from "./github-actions.js";
import {
  formatLocalAgentRunReport,
  isLocalAgentTask,
  LOCAL_AGENT_TASK_TYPE,
  localAgentRunExitCode,
  runLocalAgentTask,
  type RunLocalAgentTaskResult
} from "./local-agent.js";
import { withRunsteadManagerLock } from "./manager-lock.js";
import { resolveModelProviderModel } from "./model-provider-runtime.js";
import { blockTask, listTasks } from "./tasks.js";
import {
  runTaskVerifiersUnlocked,
  type RunTaskVerifierCommandResult
} from "./verifier-runner.js";
import type { CommandVerifierInput } from "./verifier-evidence.js";
import type { WorkerProcessRunner } from "./wrapped-worker.js";

const RUN_ONCE_SUPPORTED_TASK_TYPES = [
  "run_local_verifiers",
  LOCAL_AGENT_TASK_TYPE,
  "ci_repair",
  "manual_review"
];
const STARTUP_INTERNAL_TASK_TYPES = new Set([
  "generate_agent_context",
  "define_measurement_framework",
  "inspect_repo_readiness",
  "startup_remediation",
  "run_mvp_verifiers"
]);

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

interface RunOnceModelProvider {
  provider?: string;
  model?: string;
  baseUrl?: string;
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

async function resolveOptionalRunModelProvider(
  cwd: string,
  requested: RunOnceModelProvider
): Promise<RunOnceModelProvider> {
  try {
    const resolved = await resolveModelProviderModel({
      cwd,
      ...(requested.provider === undefined
        ? {}
        : { explicitProvider: requested.provider }),
      ...(requested.model === undefined ? {} : { explicitModel: requested.model }),
      ...(requested.baseUrl === undefined ? {} : { explicitBaseUrl: requested.baseUrl })
    });

    return {
      provider: resolved.selection.provider,
      model: resolved.model,
      ...(resolved.selection.baseUrl === undefined
        ? {}
        : { baseUrl: resolved.selection.baseUrl })
    };
  } catch {
    return requested;
  }
}

export function pickNextQueuedTask(cwd = process.cwd()): Task | undefined {
  return listTasks({ cwd })
    .tasks.filter(
      (task) =>
        task.status === "queued" &&
        !isStartupInternalTask(task) &&
        (task.type !== "ci_repair" ||
          isCiRepairPullRequestResumeTask(task) ||
          isRunnableCiRepairTask(task))
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
}

function isStartupInternalTask(task: Task): boolean {
  return (
    task.domain === "ai-native-startup" && STARTUP_INTERNAL_TASK_TYPES.has(task.type)
  );
}

function isRunnableCiRepairTask(task: Task): boolean {
  return (
    task.domain === "repo-maintenance" &&
    task.type === "ci_repair" &&
    task.status === "queued" &&
    ciRepairTaskRunId(task) !== undefined &&
    task.input.logEvidenceType === "github_workflow_run" &&
    isRecord(task.input.workflowRun) &&
    verifierCommandsFromCiRepairTask(task).length > 0
  );
}

function ciRepairTaskRunId(task: Task): string | undefined {
  const runId = task.input.runId;

  if (typeof runId === "string" || typeof runId === "number") {
    return String(runId);
  }

  return undefined;
}

function workerFromCiRepairTask(task: Task): CiRepairWorkerKind | undefined {
  const worker = task.input.worker;

  if (worker === "codex_cli" || worker === "claude_code" || worker === "codex_direct") {
    return worker;
  }

  const context = task.output?.ciRepairOrchestrator;

  if (!isRecord(context)) {
    return undefined;
  }

  const requestedWorker = context.requestedWorker;
  const workerResult = context.workerResult;

  if (
    requestedWorker === "codex_cli" ||
    requestedWorker === "claude_code" ||
    requestedWorker === "codex_direct"
  ) {
    return requestedWorker;
  }

  if (isRecord(workerResult)) {
    const completedWorker = workerResult.worker;

    if (
      completedWorker === "codex_cli" ||
      completedWorker === "claude_code" ||
      completedWorker === "codex_direct"
    ) {
      return completedWorker;
    }
  }

  return undefined;
}

function modelFromCiRepairTask(task: Task): string | undefined {
  const model = task.input.model;

  if (typeof model === "string" && model.trim().length > 0) {
    return model.trim();
  }

  const context = task.output?.ciRepairOrchestrator;

  if (!isRecord(context)) {
    return undefined;
  }

  const requestedModel = context.requestedModel;

  return typeof requestedModel === "string" && requestedModel.trim().length > 0
    ? requestedModel.trim()
    : undefined;
}

function providerFromCiRepairTask(task: Task): string | undefined {
  const provider = task.input.provider;

  if (typeof provider === "string" && provider.trim().length > 0) {
    return provider.trim();
  }

  const context = task.output?.ciRepairOrchestrator;

  if (!isRecord(context)) {
    return undefined;
  }

  const requestedProvider = context.requestedProvider;

  return typeof requestedProvider === "string" && requestedProvider.trim().length > 0
    ? requestedProvider.trim()
    : undefined;
}

function baseUrlFromCiRepairTask(task: Task): string | undefined {
  const baseUrl = task.input.baseUrl;

  if (typeof baseUrl === "string" && baseUrl.trim().length > 0) {
    return baseUrl.trim();
  }

  const context = task.output?.ciRepairOrchestrator;

  if (!isRecord(context)) {
    return undefined;
  }

  const requestedBaseUrl = context.requestedBaseUrl;

  return typeof requestedBaseUrl === "string" && requestedBaseUrl.trim().length > 0
    ? requestedBaseUrl.trim()
    : undefined;
}

async function defaultCiRepairWorker(input: {
  options: RunOnceOptions;
  modelProvider: RunOnceModelProvider;
}): Promise<CiRepairWorkerKind> {
  if (input.modelProvider.model === undefined) {
    return "codex_cli";
  }

  if (
    input.modelProvider.provider !== undefined &&
    input.modelProvider.provider !== "codex"
  ) {
    return "codex_direct";
  }

  const status = await (input.options.codexAuthStatus ?? getCodexAuthStatus)();

  return status.loggedIn && status.accessTokenExpired !== true
    ? "codex_direct"
    : "codex_cli";
}

function verifierCommandsFromCiRepairTask(task: Task): CommandVerifierInput[] {
  const commands = task.input.commands;

  if (!Array.isArray(commands)) {
    return [];
  }

  return commands.flatMap((command): CommandVerifierInput[] => {
    if (!isRecord(command)) {
      return [];
    }

    const name = command.name;
    const commandText = command.command;

    return typeof name === "string" && typeof commandText === "string"
      ? [
          {
            name,
            command: commandText
          }
        ]
      : [];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function formatRunOnceReport(result: RunOnceResult): string {
  if (!result.ranTask) {
    return ["Runstead run --once", "Status: idle", "Reason: no queued task"].join("\n");
  }

  if (result.ciRepairResult !== undefined) {
    return [
      "Runstead run --once",
      `Task: ${result.task.id}`,
      `Type: ${result.task.type}`,
      `Status: ${result.task.status}`,
      `CI repair: ${result.ciRepairResult.status}`,
      `Branch: ${result.ciRepairResult.branchName}`,
      ...(result.ciRepairResult.pullRequest === undefined
        ? []
        : [`Pull request: ${result.ciRepairResult.pullRequest.url ?? "created"}`]),
      ...(result.ciRepairResult.approval === undefined
        ? []
        : [`Approval: waiting ${result.ciRepairResult.approval.id}`])
    ].join("\n");
  }

  if (result.localAgentResult !== undefined) {
    return [
      "Runstead run --once",
      ...formatLocalAgentRunReport(result.localAgentResult).split("\n").slice(1)
    ].join("\n");
  }

  if (result.task.status === "blocked" && result.commandResults === undefined) {
    return [
      "Runstead run --once",
      `Task: ${result.task.id}`,
      `Type: ${result.task.type}`,
      "Status: blocked",
      `Blocked: ${taskOutputReason(result.task) ?? "unsupported_task_type"}`
    ].join("\n");
  }

  return [
    "Runstead run --once",
    `Task: ${result.task.id}`,
    `Type: ${result.task.type}`,
    `Status: ${result.task.status}`,
    "Verifiers:",
    ...(result.commandResults ?? []).map(
      (command) =>
        `  ${command.verifier}: exit=${command.exitCode ?? "unknown"} evidence=${command.evidenceId}`
    )
  ].join("\n");
}

function taskOutputReason(task: Task): string | undefined {
  const reason = task.output?.reason;

  return typeof reason === "string" ? reason : undefined;
}

export function runOnceExitCode(result: RunOnceResult): number {
  if (result.ranTask && result.localAgentResult !== undefined) {
    return localAgentRunExitCode(result.localAgentResult);
  }

  return result.ranTask &&
    (result.task.status === "failed" ||
      result.task.status === "blocked" ||
      result.task.status === "waiting_approval")
    ? 1
    : 0;
}
