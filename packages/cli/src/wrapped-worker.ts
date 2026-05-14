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
export const DEFAULT_WORKER_TIMEOUT_MS = 30 * 60_000;
export const DEFAULT_WORKER_MAX_OUTPUT_BYTES = 1024 * 1024 * 10;

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
  enforcement: "policy_gated_wrapper";
  enforcementNotes: string[];
  allowedScope: string[];
  deniedActions: string[];
  approvalRequired: string[];
  verifierContract: string[];
  launchGuardrails: WrappedWorkerLaunchGuardrails;
}

export interface WrappedWorkerLaunchGuardrails {
  worker: WrappedWorkerKind;
  sandboxMode?: "workspace-write";
  permissionMode?: "default";
  disallowedTools: string[];
}

export interface WrappedWorkerRunOptions extends WrappedWorkerPromptInput {
  runner?: WorkerProcessRunner;
  checkpointDir?: string;
  checkpointBefore?: WorkspaceCheckpoint;
  checkpointRunner?: GitCheckpointRunner;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface WorkerProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type WorkerProcessRunner = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    maxOutputBytes?: number;
  }
) => Promise<WorkerProcessResult>;

export interface WrappedWorkerRunResult extends WorkerProcessResult {
  worker: WrappedWorkerKind;
  prompt: string;
  command: string;
  args: string[];
  governance: WrappedWorkerGovernanceManifest;
  checkpointBefore?: WorkspaceCheckpoint;
}

const CLAUDE_DISALLOWED_TOOLS = [
  "Bash(git push *)",
  "Bash(gh pr create *)",
  "Bash(gh api --method POST *)",
  "Bash(curl *)",
  "Bash(wget *)",
  "Bash(npm install *)",
  "Bash(npm i *)",
  "Bash(pnpm add *)",
  "Bash(yarn add *)",
  "Bash(bun add *)"
];

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
    "Enforcement boundary:",
    "Runstead policy-gates this worker launch, starts it with worker-native guardrails, and verifies the resulting diff; worker-internal tool calls are not fully hard-proxied in wrapper mode.",
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
    enforcement: "policy_gated_wrapper",
    enforcementNotes: [
      "Runstead policy-gates worker launch.",
      "Runstead starts wrapped workers with worker-native sandbox or permission guardrails.",
      "Runstead verifies diff scope and command evidence after the worker exits.",
      "Worker-internal tool calls are not fully hard-proxied in wrapper mode."
    ],
    allowedScope: input.allowedScope ?? ["repository working tree"],
    deniedActions: input.deniedActions ?? ["modify protected paths", "access secrets"],
    approvalRequired: input.approvalRequired ?? [
      "dependency changes",
      "external writes"
    ],
    verifierContract: input.verifierContract ?? input.task.verifiers,
    launchGuardrails: buildWrappedWorkerLaunchGuardrails(input.worker)
  };
}

export function buildWrappedWorkerLaunchGuardrails(
  worker: WrappedWorkerKind
): WrappedWorkerLaunchGuardrails {
  switch (worker) {
    case "claude_code":
      return {
        worker,
        permissionMode: "default",
        disallowedTools: [...CLAUDE_DISALLOWED_TOOLS]
      };
    case "codex_cli":
      return {
        worker,
        sandboxMode: "workspace-write",
        disallowedTools: []
      };
  }
}

export async function startWrappedWorker(
  options: WrappedWorkerRunOptions
): Promise<WrappedWorkerRunResult> {
  const prompt = buildWrappedWorkerPrompt(options);
  const governance = buildWrappedWorkerGovernanceManifest(options);
  const command = workerCommand(options.worker, prompt, {
    workspace: options.workspace
  });
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
      ...(options.env === undefined ? {} : { env: options.env }),
      timeoutMs: options.timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULT_WORKER_MAX_OUTPUT_BYTES
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
  prompt: string,
  options: { workspace?: string } = {}
): { command: string; args: string[] } {
  switch (worker) {
    case "claude_code":
      return {
        command: "claude",
        args: [
          "-p",
          "--permission-mode",
          "default",
          "--disallowedTools",
          CLAUDE_DISALLOWED_TOOLS.join(","),
          prompt
        ]
      };
    case "codex_cli":
      return {
        command: "codex",
        args: [
          "exec",
          "--sandbox",
          "workspace-write",
          ...(options.workspace === undefined
            ? []
            : ["--cd", resolve(options.workspace)]),
          prompt
        ]
      };
  }
}

function bulletList(values: string[]): string {
  return values.map((value) => `- ${value}`).join("\n");
}

async function runWorkerProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    maxOutputBytes?: number;
  }
): Promise<WorkerProcessResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      maxBuffer: options.maxOutputBytes ?? DEFAULT_WORKER_MAX_OUTPUT_BYTES,
      timeout: options.timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS,
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
