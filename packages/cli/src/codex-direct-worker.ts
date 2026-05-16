import { createHash } from "node:crypto";

import type { Goal, JsonObject, Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import {
  type CodexResponsesInputItem,
  type CodexResponsesRequest,
  type CodexResponsesResult,
  type CodexResponsesTool,
  CodexResponsesTransport
} from "./codex-responses-transport.js";
import {
  readGovernedWorkspaceFile,
  writeGovernedWorkspaceFile
} from "./filesystem-proxy.js";
import {
  runGovernedToolAction,
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "./governed-action.js";
import type { ActionEnvelope, PolicyProfile } from "./policy.js";
import {
  finishWorkerRun,
  startWorkerRun,
  type FinishWorkerRunOptions
} from "./runtime-audit.js";
import { runShellCommand, type ShellCommandResult } from "./shell-executor.js";

export const CODEX_DIRECT_WORKER_KIND = "codex_direct";
export const DEFAULT_CODEX_DIRECT_MAX_TURNS = 12;

export interface CodexDirectWorkerOptions {
  cwd: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  goal: Goal;
  task: Task;
  model: string;
  prompt?: string;
  evidenceDir: string;
  transport: CodexDirectTransport;
  maxTurns?: number;
  now?: Date;
}

export interface CodexDirectTransport {
  createResponse(request: CodexResponsesRequest): Promise<CodexResponsesResult>;
}

export interface CodexDirectWorkerResult {
  worker: typeof CODEX_DIRECT_WORKER_KIND;
  model: string;
  status: "completed" | "waiting_approval" | "blocked" | "failed";
  exitCode: number;
  summary: string;
  toolCalls: number;
  workerRun: WorkerRun;
  approval?: {
    id: string;
    actionId: string;
    policyDecisionId: string;
    reason: string;
  };
}

type CodexDirectToolName =
  | "read_file"
  | "write_file"
  | "run_command"
  | "git_status"
  | "git_diff";

interface CodexDirectToolCall {
  id: string;
  name: CodexDirectToolName;
  arguments: Record<string, unknown>;
}

export function createCodexDirectTransport(options: {
  baseUrl: string;
  accessToken: string;
  fetch?: ConstructorParameters<typeof CodexResponsesTransport>[0]["fetch"];
}): CodexDirectTransport {
  return new CodexResponsesTransport({
    baseUrl: options.baseUrl,
    accessToken: options.accessToken,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch })
  });
}

export async function runCodexDirectWorker(
  options: CodexDirectWorkerOptions
): Promise<CodexDirectWorkerResult> {
  const workerRun = startWorkerRun({
    database: options.database,
    task: options.task,
    workerType: CODEX_DIRECT_WORKER_KIND,
    enforcementLevel: "hard_proxy_tool_calls",
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const messages: CodexResponsesInputItem[] = [
    {
      role: "user",
      content: options.prompt ?? buildCodexDirectUserPrompt(options)
    }
  ];
  let executedToolCalls = 0;

  try {
    for (
      let turn = 0;
      turn < (options.maxTurns ?? DEFAULT_CODEX_DIRECT_MAX_TURNS);
      turn += 1
    ) {
      const request: CodexResponsesRequest = {
        model: options.model,
        instructions: buildCodexDirectInstructions(options),
        input: messages,
        tools: codexDirectToolDefinitions(),
        sessionId: options.task.id
      };
      const response = await runGovernedModelInference({
        ...options,
        workerRun,
        request
      });

      if (response.toolCalls.length === 0) {
        const summary = response.outputText || "Codex Direct worker completed.";

        return completedWorkerResult({
          options,
          workerRun,
          status: "completed",
          exitCode: 0,
          summary,
          toolCalls: executedToolCalls
        });
      }

      for (const rawToolCall of response.toolCalls) {
        const toolCall = parseCodexDirectToolCall(rawToolCall);
        const toolOutput = await runCodexDirectTool({
          ...options,
          workerRun,
          toolCall
        });

        executedToolCalls += 1;
        messages.push({
          type: "function_call",
          call_id: rawToolCall.id,
          name: rawToolCall.name,
          arguments: rawToolCall.arguments
        });
        messages.push({
          type: "function_call_output",
          call_id: rawToolCall.id,
          output: toolOutput
        });
      }
    }

    return completedWorkerResult({
      options,
      workerRun,
      status: "failed",
      exitCode: 1,
      summary: "Codex Direct worker exceeded its tool-turn limit.",
      toolCalls: executedToolCalls
    });
  } catch (error) {
    if (error instanceof ToolActionApprovalRequiredError) {
      return completedWorkerResult({
        options,
        workerRun,
        status: "waiting_approval",
        exitCode: 2,
        summary: error.message,
        toolCalls: executedToolCalls,
        approval: {
          id: error.approval.id,
          actionId: error.approval.actionId,
          policyDecisionId: error.policyDecision.id,
          reason: error.approval.reason
        }
      });
    }

    if (error instanceof ToolActionDeniedError) {
      return completedWorkerResult({
        options,
        workerRun,
        status: "blocked",
        exitCode: 3,
        summary: error.message,
        toolCalls: executedToolCalls
      });
    }

    return completedWorkerResult({
      options,
      workerRun,
      status: "failed",
      exitCode: 1,
      summary: error instanceof Error ? error.message : String(error),
      toolCalls: executedToolCalls
    });
  }
}

async function runGovernedModelInference(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    request: CodexResponsesRequest;
  }
): Promise<CodexResponsesResult> {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: modelInferenceAction({
      task: options.task,
      model: options.model
    }),
    run: async () => {
      const value = await options.transport.createResponse(options.request);

      return {
        value,
        output: {
          model: options.model,
          status: value.status ?? "unknown",
          finishReason: value.finishReason,
          toolCalls: value.toolCalls.length,
          outputTextBytes: Buffer.byteLength(value.outputText, "utf8")
        }
      };
    }
  }).then((result) => result.value);
}

export function buildCodexDirectInstructions(
  options: Pick<CodexDirectWorkerOptions, "cwd" | "evidenceDir" | "goal" | "task">
): string {
  return [
    "You are a Runstead-native Codex worker.",
    "",
    "Every tool call is executed by Runstead through policy, approval, and audit.",
    "If a tool requires approval or is denied, stop and report the blocker.",
    "Do not request push, publish, or pull-request creation; Runstead owns those stages.",
    "",
    "Governance manifest:",
    JSON.stringify(
      {
        worker: CODEX_DIRECT_WORKER_KIND,
        enforcement: "hard_proxy_tool_calls",
        workspace: options.cwd,
        evidenceDir: options.evidenceDir,
        goalId: options.goal.id,
        taskId: options.task.id,
        exposedTools: codexDirectToolDefinitions().map((tool) => tool.name),
        durableStorageRules: [
          "Do not store access tokens.",
          "Do not store complete prompts.",
          "Do not store raw model output beyond concise summaries."
        ]
      },
      null,
      2
    )
  ].join("\n");
}

export function codexDirectToolDefinitions(): CodexResponsesTool[] {
  return [
    {
      type: "function",
      name: "read_file",
      description: "Read a UTF-8 file inside the workspace.",
      strict: false,
      parameters: objectSchema(
        {
          path: {
            type: "string",
            description: "Workspace-relative file path."
          }
        },
        ["path"]
      )
    },
    {
      type: "function",
      name: "write_file",
      description: "Write a UTF-8 file inside the workspace.",
      strict: false,
      parameters: objectSchema(
        {
          path: {
            type: "string",
            description: "Workspace-relative file path."
          },
          content: {
            type: "string",
            description: "Complete file contents."
          },
          createDirs: {
            type: "boolean",
            description: "Create parent directories when true."
          }
        },
        ["path", "content"]
      )
    },
    {
      type: "function",
      name: "run_command",
      description: "Run a shell command in the workspace.",
      strict: false,
      parameters: objectSchema(
        {
          command: {
            type: "string",
            description: "Shell command to execute."
          },
          timeoutMs: {
            type: "number",
            description: "Optional command timeout in milliseconds."
          }
        },
        ["command"]
      )
    },
    {
      type: "function",
      name: "git_status",
      description: "Return concise git status for the workspace.",
      strict: false,
      parameters: objectSchema({}, [])
    },
    {
      type: "function",
      name: "git_diff",
      description: "Return git diff for the workspace.",
      strict: false,
      parameters: objectSchema(
        {
          path: {
            type: "string",
            description: "Optional workspace-relative path to diff."
          }
        },
        []
      )
    }
  ];
}

async function runCodexDirectTool(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    toolCall: CodexDirectToolCall;
  }
): Promise<string> {
  try {
    return await executeCodexDirectTool(options);
  } catch (error) {
    if (
      error instanceof ToolActionApprovalRequiredError ||
      error instanceof ToolActionDeniedError
    ) {
      throw error;
    }

    return JSON.stringify(toolExecutionErrorOutput(error));
  }
}

async function executeCodexDirectTool(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    toolCall: CodexDirectToolCall;
  }
): Promise<string> {
  switch (options.toolCall.name) {
    case "read_file":
      return JSON.stringify(
        await readGovernedWorkspaceFile({
          ...governedToolOptions(options),
          path: requiredString(options.toolCall.arguments.path, "path")
        }).then((result) => result.value)
      );
    case "write_file":
      return JSON.stringify(
        await writeGovernedWorkspaceFile({
          ...governedToolOptions(options),
          path: requiredString(options.toolCall.arguments.path, "path"),
          content: requiredString(options.toolCall.arguments.content, "content"),
          createDirs: options.toolCall.arguments.createDirs === true
        }).then((result) => result.value)
      );
    case "run_command":
      return JSON.stringify(
        await runGovernedShellCommand({
          ...options,
          command: requiredString(options.toolCall.arguments.command, "command"),
          ...optionalTimeoutMs(options.toolCall.arguments.timeoutMs)
        })
      );
    case "git_status":
      return JSON.stringify(await runGovernedGitRead(options, "git status --short"));
    case "git_diff": {
      const path = optionalString(options.toolCall.arguments.path);
      const command =
        path === undefined ? "git diff" : `git diff -- ${shellQuote(path)}`;

      return JSON.stringify(await runGovernedGitRead(options, command));
    }
  }
}

async function runGovernedShellCommand(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    command: string;
    timeoutMs?: number;
  }
): Promise<ShellCommandResult> {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: shellAction({
      cwd: options.cwd,
      command: options.command
    }),
    run: async () => {
      const value = await runShellCommand({
        command: options.command,
        cwd: options.cwd,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
      });

      return {
        value,
        output: shellCommandOutput(value)
      };
    }
  }).then((result) => result.value);
}

async function runGovernedGitRead(
  options: CodexDirectWorkerOptions & { workerRun: WorkerRun },
  command: string
): Promise<Pick<ShellCommandResult, "exitCode" | "stdout" | "stderr">> {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: gitReadAction({
      cwd: options.cwd,
      actionType: command.startsWith("git diff") ? "git.diff" : "git.status"
    }),
    run: async () => {
      const value = await runShellCommand({
        command,
        cwd: options.cwd
      });

      return {
        value: {
          exitCode: value.exitCode,
          stdout: value.stdout,
          stderr: value.stderr
        },
        output: shellCommandOutput(value)
      };
    }
  }).then((result) => result.value);
}

function completedWorkerResult(input: {
  options: CodexDirectWorkerOptions;
  workerRun: WorkerRun;
  status: CodexDirectWorkerResult["status"];
  exitCode: number;
  summary: string;
  toolCalls: number;
  approval?: CodexDirectWorkerResult["approval"];
}): CodexDirectWorkerResult {
  const output = {
    worker: CODEX_DIRECT_WORKER_KIND,
    model: input.options.model,
    summary: input.summary,
    toolCalls: input.toolCalls,
    ...(input.approval === undefined ? {} : { approval: input.approval })
  };
  const workerRun = finishWorkerRun({
    database: input.options.database,
    workerRun: input.workerRun,
    status: workerRunStatus(input.status),
    output,
    ...(input.options.now === undefined ? {} : { now: input.options.now })
  } satisfies FinishWorkerRunOptions);

  return {
    worker: CODEX_DIRECT_WORKER_KIND,
    model: input.options.model,
    status: input.status,
    exitCode: input.exitCode,
    summary: input.summary,
    toolCalls: input.toolCalls,
    workerRun,
    ...(input.approval === undefined ? {} : { approval: input.approval })
  };
}

function workerRunStatus(
  status: CodexDirectWorkerResult["status"]
): Exclude<WorkerRun["status"], "running"> {
  switch (status) {
    case "completed":
      return "completed";
    case "waiting_approval":
      return "waiting_approval";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
  }
}

function buildCodexDirectUserPrompt(
  options: Pick<CodexDirectWorkerOptions, "goal" | "task">
): string {
  return [
    `Goal: ${options.goal.title} (${options.goal.id})`,
    `Task: ${options.task.type} (${options.task.id})`,
    "",
    "Task input:",
    JSON.stringify(options.task.input, null, 2),
    "",
    "Verifiers:",
    options.task.verifiers.map((verifier) => `- ${verifier}`).join("\n") || "- none"
  ].join("\n");
}

function parseCodexDirectToolCall(input: {
  id: string;
  name: string;
  arguments: string;
}): CodexDirectToolCall {
  if (!isCodexDirectToolName(input.name)) {
    throw new Error(`Unsupported Codex Direct tool: ${input.name}`);
  }

  return {
    id: input.id,
    name: input.name,
    arguments: parseToolArguments(input.arguments)
  };
}

function parseToolArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    // Fall through to the consistent error below.
  }

  throw new Error("Codex Direct tool arguments must be a JSON object");
}

function governedToolOptions(
  options: CodexDirectWorkerOptions & { workerRun: WorkerRun }
) {
  return {
    cwd: options.cwd,
    stateDb: options.stateDb,
    database: options.database,
    policy: options.policy,
    task: options.task,
    workerRun: options.workerRun,
    requestedBy: "runstead:codex-direct",
    ...(options.now === undefined ? {} : { now: options.now })
  };
}

function shellAction(input: { cwd: string; command: string }): ActionEnvelope {
  return {
    actionId: stableActionId("shell.exec", [input.cwd, input.command]),
    actionType: "shell.exec",
    resource: {
      type: "process",
      id: "workspace-shell"
    },
    context: {
      cwd: input.cwd,
      command: input.command,
      sideEffects: ["execute_process"]
    }
  };
}

function gitReadAction(input: {
  cwd: string;
  actionType: "git.status" | "git.diff";
}): ActionEnvelope {
  return {
    actionId: stableActionId(input.actionType, [input.cwd]),
    actionType: input.actionType,
    resource: {
      type: "repository",
      id: input.cwd
    },
    context: {
      cwd: input.cwd
    }
  };
}

function modelInferenceAction(input: { task: Task; model: string }): ActionEnvelope {
  return {
    actionId: stableActionId("model_inference_request", [input.task.id, input.model]),
    actionType: "model.inference.request",
    resource: {
      type: "model_provider",
      id: "chatgpt_codex"
    },
    context: {
      networkDomains: ["chatgpt.com"],
      sideEffects: ["network_write_external", "llm_data_egress"]
    }
  };
}

function shellCommandOutput(result: ShellCommandResult): JsonObject {
  return {
    command: result.command,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    forceKilled: result.forceKilled,
    stdoutBytes: Buffer.byteLength(result.stdout, "utf8"),
    stderrBytes: Buffer.byteLength(result.stderr, "utf8"),
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated
  };
}

function toolExecutionErrorOutput(error: unknown): JsonObject {
  return {
    ok: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "Error"
    }
  };
}

function objectSchema(
  properties: Record<string, unknown>,
  required: string[]
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Codex Direct tool argument ${field} must be a non-empty string`);
  }

  return value;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return undefined;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  return undefined;
}

function optionalTimeoutMs(value: unknown): { timeoutMs?: number } {
  const timeoutMs = optionalPositiveInteger(value);

  return timeoutMs === undefined ? {} : { timeoutMs };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isCodexDirectToolName(value: string): value is CodexDirectToolName {
  return ["read_file", "write_file", "run_command", "git_status", "git_diff"].includes(
    value
  );
}

function stableActionId(prefix: string, parts: unknown[]): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 12);

  return `act_${prefix.replaceAll(".", "_")}_${hash}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
