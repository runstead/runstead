import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import type { Goal, Task } from "@runstead/core";

import {
  createWorkspaceCheckpoint,
  type GitCheckpointRunner,
  type WorkspaceCheckpoint
} from "./checkpoints.js";

const execFileAsync = promisify(execFile);

export type WrappedWorkerKind = "claude_code" | "codex_cli";

export interface WrappedWorkerPromptInput {
  worker: WrappedWorkerKind;
  goal: Goal;
  task: Task;
  workspace: string;
  evidenceDir: string;
  policySummary?: string;
  allowedScope?: string[];
  deniedActions?: string[];
  approvalRequired?: string[];
  verifierContract?: string[];
  instructions?: string[];
}

export interface WrappedWorkerGovernanceManifest {
  worker: WrappedWorkerKind;
  taskId: string;
  goalId: string;
  domain: string;
  workspace: string;
  evidenceDir: string;
  enforcement: "policy_enforced";
  allowedScope: string[];
  deniedActions: string[];
  approvalRequired: string[];
  verifierContract: string[];
}

export interface WrappedWorkerRunOptions extends WrappedWorkerPromptInput {
  runner?: WorkerProcessRunner;
  checkpointDir?: string;
  checkpointBefore?: WorkspaceCheckpoint;
  checkpointRunner?: GitCheckpointRunner;
  env?: Record<string, string>;
}

export interface WorkerProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type WorkerProcessRunner = (
  command: string,
  args: string[],
  options: { cwd: string; env?: Record<string, string> }
) => Promise<WorkerProcessResult>;

export interface WrappedWorkerRunResult extends WorkerProcessResult {
  worker: WrappedWorkerKind;
  prompt: string;
  command: string;
  args: string[];
  governance: WrappedWorkerGovernanceManifest;
  checkpointBefore?: WorkspaceCheckpoint;
}

export function buildWrappedWorkerPrompt(input: WrappedWorkerPromptInput): string {
  const governance = buildWrappedWorkerGovernanceManifest(input);

  return [
    "You are a Runstead worker.",
    "",
    "Goal:",
    `${input.goal.title} (${input.goal.id})`,
    "",
    "Task:",
    `${input.task.type} (${input.task.id})`,
    "",
    "Domain:",
    input.goal.domain,
    "",
    "Workspace:",
    input.workspace,
    "",
    "Evidence directory:",
    input.evidenceDir,
    "",
    "Allowed scope:",
    bulletList(governance.allowedScope),
    "",
    "Denied actions:",
    bulletList(governance.deniedActions),
    "",
    "Approval required for:",
    bulletList(governance.approvalRequired),
    "",
    "Verifier contract:",
    bulletList(governance.verifierContract),
    "",
    "Runstead governance manifest:",
    JSON.stringify(governance, null, 2),
    "",
    ...(input.policySummary === undefined
      ? []
      : ["Policy summary:", input.policySummary, ""]),
    "Rules:",
    "1. Make the smallest safe change.",
    "2. Do not modify denied paths.",
    "3. Do not access secrets.",
    "4. Do not install or upgrade dependencies unless approval is granted.",
    "5. Completion requires Runstead verifier success.",
    "6. Return structured JSON and do not claim success without evidence.",
    "",
    "Output JSON:",
    JSON.stringify(
      {
        summary: "string",
        files_changed: ["string"],
        commands_run: ["string"],
        risks: ["string"],
        needs_approval: false,
        approval_reason: null
      },
      null,
      2
    ),
    ...(input.instructions === undefined || input.instructions.length === 0
      ? []
      : ["", "Additional instructions:", bulletList(input.instructions)])
  ].join("\n");
}

export function buildWrappedWorkerGovernanceManifest(
  input: WrappedWorkerPromptInput
): WrappedWorkerGovernanceManifest {
  return {
    worker: input.worker,
    taskId: input.task.id,
    goalId: input.goal.id,
    domain: input.goal.domain,
    workspace: input.workspace,
    evidenceDir: input.evidenceDir,
    enforcement: "policy_enforced",
    allowedScope: input.allowedScope ?? ["repository working tree"],
    deniedActions: input.deniedActions ?? ["modify protected paths", "access secrets"],
    approvalRequired: input.approvalRequired ?? [
      "dependency changes",
      "external writes"
    ],
    verifierContract: input.verifierContract ?? input.task.verifiers
  };
}

export async function startWrappedWorker(
  options: WrappedWorkerRunOptions
): Promise<WrappedWorkerRunResult> {
  const prompt = buildWrappedWorkerPrompt(options);
  const governance = buildWrappedWorkerGovernanceManifest(options);
  const command = workerCommand(options.worker, prompt);
  const checkpointBefore =
    options.checkpointBefore ??
    (options.checkpointDir === undefined
      ? undefined
      : await createWorkspaceCheckpoint({
          workspace: options.workspace,
          checkpointDir: options.checkpointDir,
          ...(options.checkpointRunner === undefined
            ? {}
            : { runner: options.checkpointRunner })
        }));
  const result = await (options.runner ?? runWorkerProcess)(
    command.command,
    command.args,
    {
      cwd: resolve(options.workspace),
      ...(options.env === undefined ? {} : { env: options.env })
    }
  );

  return {
    worker: options.worker,
    prompt,
    command: command.command,
    args: command.args,
    governance,
    ...(checkpointBefore === undefined ? {} : { checkpointBefore }),
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode
  };
}

export function workerCommand(
  worker: WrappedWorkerKind,
  prompt: string
): { command: string; args: string[] } {
  switch (worker) {
    case "claude_code":
      return {
        command: "claude",
        args: ["-p", prompt]
      };
    case "codex_cli":
      return {
        command: "codex",
        args: ["exec", prompt]
      };
  }
}

function bulletList(values: string[]): string {
  return values.map((value) => `- ${value}`).join("\n");
}

async function runWorkerProcess(
  command: string,
  args: string[],
  options: { cwd: string; env?: Record<string, string> }
): Promise<WorkerProcessResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      maxBuffer: 1024 * 1024 * 10,
      windowsHide: true
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0
    };
  } catch (error) {
    return {
      stdout: commandOutput(error, "stdout"),
      stderr: commandOutput(error, "stderr"),
      exitCode: commandExitCode(error)
    };
  }
}

function commandExitCode(error: unknown): number {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "number"
  ) {
    return error.code;
  }

  return 1;
}

function commandOutput(error: unknown, key: "stdout" | "stderr"): string {
  if (typeof error === "object" && error !== null) {
    const output = (error as Record<string, unknown>)[key];

    if (typeof output === "string") {
      return output;
    }
  }

  return "";
}
