import { resolve } from "node:path";

import type { Task } from "@runstead/core";

import {
  ciRepairPullRequestResumeRunId,
  isCiRepairPullRequestResumeTask,
  runCiRepairOrchestratorUnlocked,
  type CiRepairGitRunner,
  type RunCiRepairOrchestratorOptions,
  type RunCiRepairOrchestratorResult
} from "./ci-repair-orchestrator.js";
import type { GitHubCliRunner } from "./github-actions.js";
import { withRunsteadManagerLock } from "./manager-lock.js";
import { blockTask, listTasks } from "./tasks.js";
import {
  runTaskVerifiersUnlocked,
  type RunTaskVerifierCommandResult
} from "./verifier-runner.js";
import type { CommandVerifierInput } from "./verifier-evidence.js";

const RUN_ONCE_SUPPORTED_TASK_TYPES = ["run_local_verifiers", "ci_repair"];

export interface RunOnceOptions {
  cwd?: string;
  authToken?: string;
  githubRunner?: GitHubCliRunner;
  gitRunner?: CiRepairGitRunner;
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

  if (task !== undefined && isCiRepairPullRequestResumeTask(task)) {
    const runId = ciRepairPullRequestResumeRunId(task);

    if (runId === undefined) {
      throw new Error(`Task ${task.id} is not ready to resume CI repair`);
    }

    const result = await runCiRepairOrchestratorUnlocked({
      cwd,
      runId,
      worker: "codex_cli",
      verifierCommands: [],
      ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
      ...(options.githubRunner === undefined
        ? {}
        : { githubRunner: options.githubRunner }),
      ...(options.gitRunner === undefined ? {} : { gitRunner: options.gitRunner }),
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

    const result = await (
      options.ciRepairOrchestrator ?? runCiRepairOrchestratorUnlocked
    )({
      cwd,
      runId,
      worker: "codex_cli",
      verifierCommands: verifierCommandsFromCiRepairTask(task),
      ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
      ...(options.githubRunner === undefined
        ? {}
        : { githubRunner: options.githubRunner }),
      ...(options.gitRunner === undefined ? {} : { gitRunner: options.gitRunner }),
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return {
      cwd,
      ranTask: true,
      task: result.ciRepair.task,
      ciRepairResult: result
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

export function pickNextQueuedTask(cwd = process.cwd()): Task | undefined {
  return listTasks({ cwd })
    .tasks.filter(
      (task) =>
        task.status === "queued" &&
        (task.type !== "ci_repair" ||
          isCiRepairPullRequestResumeTask(task) ||
          isRunnableCiRepairTask(task))
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
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
  return result.ranTask &&
    (result.task.status === "failed" ||
      result.task.status === "blocked" ||
      result.task.status === "waiting_approval")
    ? 1
    : 0;
}
