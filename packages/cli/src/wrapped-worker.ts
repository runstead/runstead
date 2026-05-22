import { spawn, spawnSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { Goal, Task } from "@runstead/core";

import {
  createWorkspaceCheckpoint,
  type GitCheckpointRunner,
  type WorkspaceCheckpoint
} from "./checkpoints.js";

export const DEFAULT_WORKER_TIMEOUT_MS = 30 * 60_000;
export const DEFAULT_WORKER_MAX_OUTPUT_BYTES = 1024 * 1024 * 10;

export type WrappedWorkerKind = "claude_code" | "codex_cli";
export type WrappedWorkerInternalToolProxyMode = "none" | "hard_proxy";

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
  requiredInternalToolProxy?: WrappedWorkerInternalToolProxyMode;
}

export interface WrappedWorkerGovernanceManifest {
  worker: WrappedWorkerKind;
  taskId: string;
  goalId: string;
  domain: string;
  workspace: string;
  evidenceDir: string;
  enforcement: "policy_gated_wrapper";
  capabilities: WrappedWorkerEnforcementCapabilities;
  internalToolProxy: WrappedWorkerInternalToolProxyStatus;
  enforcementNotes: string[];
  allowedScope: string[];
  deniedActions: string[];
  approvalRequired: string[];
  verifierContract: string[];
  launchGuardrails: WrappedWorkerLaunchGuardrails;
}

export interface WrappedWorkerEnforcementCapabilities {
  launchPolicyGate: boolean;
  workerNativeGuardrails: boolean;
  workspaceCheckpoint: boolean;
  postRunDiffVerification: boolean;
  hardProxyToolCalls: boolean;
}

export interface WrappedWorkerInternalToolProxyStatus {
  mode: "none";
  required: WrappedWorkerInternalToolProxyMode;
  hardProxyAvailable: boolean;
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
  workerRuntimeDir?: string;
  checkpointBefore?: WorkspaceCheckpoint;
  checkpointRunner?: GitCheckpointRunner;
  model?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
  progressIntervalMs?: number;
  onProgress?: (progress: WorkerProcessProgress) => void;
}

export interface WorkerProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface WorkerProcessProgress {
  command: string;
  elapsedMs: number;
  stdoutBytes: number;
  stderrBytes: number;
  capturedBytes: number;
  workspaceChangedFiles?: number;
  workspaceRecentFiles?: string[];
}

export interface WrappedWorkerStructuredOutput {
  summary: string;
  files_changed: string[];
  commands_run: string[];
  risks: string[];
  needs_approval: boolean;
  approval_reason: string | null;
}

export interface WrappedWorkerOutputValidation {
  valid: boolean;
  reason?: string;
}

export type WorkerProcessRunner = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    maxOutputBytes?: number;
    progressIntervalMs?: number;
    onProgress?: (progress: WorkerProcessProgress) => void;
  }
) => Promise<WorkerProcessResult>;

export interface WrappedWorkerRunResult extends WorkerProcessResult {
  worker: WrappedWorkerKind;
  prompt: string;
  command: string;
  args: string[];
  governance: WrappedWorkerGovernanceManifest;
  outputValidation: WrappedWorkerOutputValidation;
  structuredOutput?: WrappedWorkerStructuredOutput;
  checkpointBefore?: WorkspaceCheckpoint;
}

export class WrappedWorkerHardProxyUnavailableError extends Error {
  constructor(worker: WrappedWorkerKind) {
    super(`Hard tool proxy enforcement is not available for wrapped worker: ${worker}`);
    this.name = "WrappedWorkerHardProxyUnavailableError";
  }
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

const WRAPPED_WORKER_STRUCTURED_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    files_changed: { type: "array", items: { type: "string" } },
    commands_run: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    needs_approval: { type: "boolean" },
    approval_reason: { type: ["string", "null"] }
  },
  required: [
    "summary",
    "files_changed",
    "commands_run",
    "risks",
    "needs_approval",
    "approval_reason"
  ],
  additionalProperties: false
};

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
  const internalToolProxy = buildWrappedWorkerInternalToolProxyStatus(input);

  return {
    worker: input.worker,
    taskId: input.task.id,
    goalId: input.goal.id,
    domain: input.goal.domain,
    workspace: input.workspace,
    evidenceDir: input.evidenceDir,
    enforcement: "policy_gated_wrapper",
    capabilities: {
      launchPolicyGate: true,
      workerNativeGuardrails: true,
      workspaceCheckpoint: true,
      postRunDiffVerification: true,
      hardProxyToolCalls: internalToolProxy.hardProxyAvailable
    },
    internalToolProxy,
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

export function buildWrappedWorkerInternalToolProxyStatus(
  input: Pick<WrappedWorkerPromptInput, "worker" | "requiredInternalToolProxy">
): WrappedWorkerInternalToolProxyStatus {
  const required = input.requiredInternalToolProxy ?? "none";
  const status: WrappedWorkerInternalToolProxyStatus = {
    mode: "none",
    required,
    hardProxyAvailable: false
  };

  if (required === "hard_proxy" && !status.hardProxyAvailable) {
    throw new WrappedWorkerHardProxyUnavailableError(input.worker);
  }

  return status;
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
    workspace: options.workspace,
    ...(options.model === undefined ? {} : { model: options.model })
  });
  const workerEnv = await buildWrappedWorkerEnv(options);
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
      ...(workerEnv === undefined ? {} : { env: workerEnv }),
      timeoutMs: options.timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULT_WORKER_MAX_OUTPUT_BYTES,
      ...(options.progressIntervalMs === undefined
        ? {}
        : { progressIntervalMs: options.progressIntervalMs }),
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress })
    }
  );
  const validation = validateWrappedWorkerStructuredOutput(result.stdout);
  const outputValidation: WrappedWorkerOutputValidation =
    validation.reason === undefined
      ? { valid: validation.valid }
      : { valid: validation.valid, reason: validation.reason };
  const finalResult =
    result.exitCode === 0 && !validation.valid
      ? {
          ...result,
          stderr: appendWorkerProcessNotice(
            result.stderr,
            validation.reason ?? "worker did not return valid structured output"
          ),
          exitCode: 1
        }
      : result;

  return {
    worker: options.worker,
    prompt,
    command: command.command,
    args: command.args,
    governance,
    outputValidation,
    ...(validation.output === undefined ? {} : { structuredOutput: validation.output }),
    ...(checkpointBefore === undefined ? {} : { checkpointBefore }),
    stdout: finalResult.stdout,
    stderr: finalResult.stderr,
    exitCode: finalResult.exitCode
  };
}

async function buildWrappedWorkerEnv(
  options: WrappedWorkerRunOptions
): Promise<Record<string, string> | undefined> {
  if (options.worker !== "codex_cli") {
    return options.env;
  }

  if (options.env?.CODEX_HOME !== undefined) {
    return options.env;
  }

  const profileDir = join(
    resolve(
      options.workerRuntimeDir ??
        join(options.workspace, ".runstead", "worker-profiles")
    ),
    "codex-cli"
  );
  await mkdir(profileDir, { recursive: true });
  await copyCodexAuth(profileDir, options.env);

  return {
    ...(options.env ?? {}),
    CODEX_HOME: profileDir,
    RUNSTEAD_WRAPPED_WORKER_PROFILE: "isolated-codex-cli"
  };
}

async function copyCodexAuth(
  profileDir: string,
  env: Record<string, string> | undefined
): Promise<void> {
  const sourceHome = resolve(
    env?.CODEX_HOME ?? process.env.CODEX_HOME ?? join(homedir(), ".codex")
  );

  try {
    await copyFile(join(sourceHome, "auth.json"), join(profileDir, "auth.json"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== "ENOENT") {
      throw error;
    }
  }
}

export function workerCommand(
  worker: WrappedWorkerKind,
  prompt: string,
  options: { workspace?: string; model?: string } = {}
): { command: string; args: string[] } {
  switch (worker) {
    case "claude_code": {
      const model = options.model?.trim();

      return {
        command: "claude",
        args: [
          "-p",
          ...(model === undefined || model.length === 0 ? [] : ["--model", model]),
          "--output-format",
          "json",
          "--json-schema",
          JSON.stringify(WRAPPED_WORKER_STRUCTURED_OUTPUT_SCHEMA),
          "--permission-mode",
          "default",
          "--disallowedTools",
          CLAUDE_DISALLOWED_TOOLS.join(","),
          "--",
          prompt
        ]
      };
    }
    case "codex_cli": {
      const model = options.model?.trim();

      return {
        command: "codex",
        args: [
          "exec",
          ...(model === undefined || model.length === 0 ? [] : ["--model", model]),
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
}

export function formatWorkerProcessProgress(progress: WorkerProcessProgress): string {
  return [
    "[runstead]",
    `wrapped worker still running: ${progress.command}`,
    `elapsed=${formatElapsed(progress.elapsedMs)}`,
    `stdout=${progress.stdoutBytes}B`,
    `stderr=${progress.stderrBytes}B`,
    ...(progress.workspaceChangedFiles === undefined
      ? []
      : [`files=${progress.workspaceChangedFiles}`]),
    ...(progress.workspaceRecentFiles === undefined ||
    progress.workspaceRecentFiles.length === 0
      ? []
      : [`recent=${progress.workspaceRecentFiles.join(",")}`])
  ].join(" ");
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes === 0 ? `${seconds}s` : `${minutes}m${seconds}s`;
}

function bulletList(values: string[]): string {
  return values.map((value) => `- ${value}`).join("\n");
}

export async function runWorkerProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    maxOutputBytes?: number;
    progressIntervalMs?: number;
    onProgress?: (progress: WorkerProcessProgress) => void;
  }
): Promise<WorkerProcessResult> {
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_WORKER_MAX_OUTPUT_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;
  const progressIntervalMs = options.progressIntervalMs ?? 30_000;

  return await new Promise<WorkerProcessResult>((resolveResult) => {
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let capturedBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let settled = false;
    const startedAt = Date.now();

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    const progress =
      options.onProgress === undefined
        ? undefined
        : setInterval(() => {
            const workspace = workerWorkspaceProgress(options.cwd);

            options.onProgress?.({
              command,
              elapsedMs: Date.now() - startedAt,
              stdoutBytes,
              stderrBytes,
              capturedBytes,
              workspaceChangedFiles: workspace.changedFiles,
              workspaceRecentFiles: workspace.recentFiles
            });
          }, progressIntervalMs);

    const resolveOnce = (result: WorkerProcessResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (progress !== undefined) {
        clearInterval(progress);
      }
      resolveResult(result);
    };

    const capture = (key: "stdout" | "stderr", chunk: Buffer): void => {
      if (capturedBytes >= maxOutputBytes) {
        outputTruncated = true;
        return;
      }

      const remainingBytes = maxOutputBytes - capturedBytes;
      const captured =
        chunk.byteLength > remainingBytes ? chunk.subarray(0, remainingBytes) : chunk;

      if (captured.byteLength < chunk.byteLength) {
        outputTruncated = true;
      }

      capturedBytes += captured.byteLength;

      if (key === "stdout") {
        stdoutBytes += captured.byteLength;
        stdout += captured.toString("utf8");
      } else {
        stderrBytes += captured.byteLength;
        stderr += captured.toString("utf8");
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      capture("stdout", chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      capture("stderr", chunk);
    });

    child.on("error", (error) => {
      resolveOnce({
        stdout,
        stderr: appendWorkerProcessNotice(stderr, error.message),
        exitCode: 1
      });
    });

    child.on("close", (code, signal) => {
      let finalStderr = stderr;

      if (outputTruncated) {
        finalStderr = appendWorkerProcessNotice(
          finalStderr,
          `worker output truncated at ${maxOutputBytes} bytes`
        );
      }

      if (timedOut) {
        finalStderr = appendWorkerProcessNotice(
          finalStderr,
          `worker timed out after ${timeoutMs} ms`
        );
      } else if (signal !== null) {
        finalStderr = appendWorkerProcessNotice(
          finalStderr,
          `worker exited from signal ${signal}`
        );
      }

      resolveOnce({
        stdout,
        stderr: finalStderr,
        exitCode: code ?? (timedOut ? 124 : 1)
      });
    });
  });
}

function workerWorkspaceProgress(cwd: string): {
  changedFiles: number;
  recentFiles: string[];
} {
  const result = spawnSync(
    "git",
    ["status", "--short", "--untracked-files=all"],
    {
      cwd,
      encoding: "utf8",
      timeout: 2_000,
      maxBuffer: 1024 * 1024
    }
  );

  if (result.status !== 0) {
    return {
      changedFiles: 0,
      recentFiles: []
    };
  }

  const files = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3))
    .filter((file) => file !== ".runstead" && !file.startsWith(".runstead/"));

  return {
    changedFiles: files.length,
    recentFiles: files.slice(0, 3)
  };
}

function appendWorkerProcessNotice(output: string, notice: string): string {
  return `${output}${output.length === 0 || output.endsWith("\n") ? "" : "\n"}[runstead] ${notice}\n`;
}

function validateWrappedWorkerStructuredOutput(
  stdout: string
): WrappedWorkerOutputValidation & { output?: WrappedWorkerStructuredOutput } {
  const trimmed = stdout.trim();

  if (trimmed.length === 0) {
    return {
      valid: false,
      reason: "worker produced no structured output"
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      valid: false,
      reason: "worker stdout is not valid JSON"
    };
  }

  const structuredCandidate = wrappedWorkerStructuredOutputCandidate(parsed);

  if (!isRecord(structuredCandidate)) {
    return {
      valid: false,
      reason: "worker JSON output must be an object"
    };
  }

  if (typeof structuredCandidate.summary !== "string") {
    return invalidWorkerOutputField("summary");
  }

  if (!isStringArray(structuredCandidate.files_changed)) {
    return invalidWorkerOutputField("files_changed");
  }

  if (!isStringArray(structuredCandidate.commands_run)) {
    return invalidWorkerOutputField("commands_run");
  }

  if (!isStringArray(structuredCandidate.risks)) {
    return invalidWorkerOutputField("risks");
  }

  if (typeof structuredCandidate.needs_approval !== "boolean") {
    return invalidWorkerOutputField("needs_approval");
  }

  if (
    structuredCandidate.approval_reason !== null &&
    typeof structuredCandidate.approval_reason !== "string"
  ) {
    return invalidWorkerOutputField("approval_reason");
  }

  return {
    valid: true,
    output: {
      summary: structuredCandidate.summary,
      files_changed: structuredCandidate.files_changed,
      commands_run: structuredCandidate.commands_run,
      risks: structuredCandidate.risks,
      needs_approval: structuredCandidate.needs_approval,
      approval_reason: structuredCandidate.approval_reason
    }
  };
}

function wrappedWorkerStructuredOutputCandidate(parsed: unknown): unknown {
  if (!isRecord(parsed)) {
    return parsed;
  }

  if (isRecord(parsed.structured_output)) {
    return parsed.structured_output;
  }

  if (isRecord(parsed.result)) {
    return parsed.result;
  }

  if (typeof parsed.result === "string") {
    const result = parsed.result.trim();

    if (result.length === 0) {
      return parsed;
    }

    try {
      return JSON.parse(result) as unknown;
    } catch {
      return parsed;
    }
  }

  return parsed;
}

function invalidWorkerOutputField(field: string): WrappedWorkerOutputValidation {
  return {
    valid: false,
    reason: `worker JSON output field ${field} is missing or invalid`
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
