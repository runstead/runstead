import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createRunsteadId,
  type Goal,
  type JsonObject,
  type Task,
  type WorkerRun
} from "@runstead/core";
import {
  runtimeExecutionSemantics,
  type RuntimeExecutionSemantics,
  type RuntimeVerificationStatus,
  type RuntimeWorkerOutcome
} from "@runstead/runtime";
import { appendEventAndProject, type RunsteadDatabase } from "@runstead/state-sqlite";

import {
  type CodexResponsesInputItem,
  type CodexResponsesFunctionCallInputItem,
  type CodexResponsesRequest,
  type CodexResponsesResult,
  type CodexResponsesTool,
  CodexResponsesTransport
} from "../codex-responses-transport.js";
import { discoverVerifierCommands } from "../verifier-discovery.js";
import {
  storeCommandVerifierEvidence,
  type CommandVerifierInput
} from "../verifier-evidence.js";
import {
  storeRepoInspectionEvidence,
  type RepoInspectionSnapshot
} from "../inspection-evidence.js";
import {
  readGovernedWorkspaceFile,
  writeGovernedWorkspaceFile
} from "../filesystem-proxy.js";
import {
  applyWorkspacePatch,
  inferWorkspacePatchTouchedFiles,
  inspectWorkspacePath,
  inspectPackageScripts,
  listWorkspaceFiles,
  readManyWorkspaceFiles,
  searchWorkspaceText,
  workspaceTree
} from "../codex-direct-native-tools.js";
import {
  runGovernedToolAction,
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "../governed-action.js";
import {
  matchesPolicyPathPattern,
  type ActionEnvelope,
  type PolicyProfile
} from "../policy.js";
import {
  finishWorkerRun,
  startWorkerRun,
  type FinishWorkerRunOptions
} from "../runtime-audit.js";
import { runShellCommand, type ShellCommandResult } from "../shell-executor.js";

export const CODEX_DIRECT_WORKER_KIND = "codex_direct";
export const DEFAULT_CODEX_DIRECT_MAX_TURNS = 12;
export const DEFAULT_CODEX_DIRECT_MODEL_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_CODEX_DIRECT_FINAL_SUMMARY_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
export const DEFAULT_CODEX_DIRECT_MODEL_REQUEST_HEARTBEAT_MS = 15 * 1000;
export const DEFAULT_CODEX_DIRECT_MODEL_REQUEST_MAX_RETRIES = 2;
export const DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_BASE_DELAY_MS = 500;
export const DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_MAX_DELAY_MS = 5 * 1000;
export const DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_JITTER_MS = 250;
const EXECUTION_LEASE_MS = 30 * 60 * 1000;
const DEPENDENCY_FILE_NAMES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb"
]);

export interface CodexDirectWorkerOptions {
  cwd: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  goal: Goal;
  task: Task;
  model: string;
  modelProviderResourceId?: string;
  modelProviderNetworkDomains?: string[];
  prompt?: string;
  evidenceDir: string;
  transport: CodexDirectTransport;
  maxTurns?: number;
  maxToolCalls?: number;
  maxFailedToolCalls?: number;
  modelRequestTimeoutMs?: number;
  modelFinalSummaryRequestTimeoutMs?: number;
  modelRequestHeartbeatMs?: number;
  modelRequestMaxRetries?: number;
  modelRequestRetryBaseDelayMs?: number;
  modelRequestRetryMaxDelayMs?: number;
  modelRequestRetryJitterMs?: number;
  finalizeOnBudget?: boolean;
  now?: Date;
}

export interface CodexDirectTransport {
  createResponse(request: CodexResponsesRequest): Promise<CodexResponsesResult>;
}

export interface CodexDirectWorkerResult {
  worker: typeof CODEX_DIRECT_WORKER_KIND;
  model: string;
  modelProvider: string;
  status: "completed" | "waiting_approval" | "interrupted" | "blocked" | "failed";
  exitCode: number;
  summary: string;
  execution: RuntimeExecutionSemantics;
  toolCalls: number;
  failedToolCalls: number;
  warnings: string[];
  interruption?: CodexDirectInterruptionSummary;
  budget?: CodexDirectBudgetSummary;
  workerRun: WorkerRun;
  approval?: {
    id: string;
    actionId: string;
    policyDecisionId: string;
    reason: string;
  };
}

export interface CodexDirectPendingPatchResume {
  approvalId: string;
  policyDecisionId: string;
  action: ActionEnvelope;
  pendingPatch: CodexDirectPendingPatchPayload;
}

export interface CodexDirectPendingPatchResumeOptions {
  cwd: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  goal: Goal;
  task: Task;
  model: string;
  modelProviderResourceId?: string;
  modelProviderNetworkDomains?: string[];
  evidenceDir: string;
  transport?: CodexDirectTransport;
  pendingPatch: CodexDirectPendingPatchResume;
  maxTurns?: number;
  maxToolCalls?: number;
  maxFailedToolCalls?: number;
  modelRequestTimeoutMs?: number;
  modelRequestHeartbeatMs?: number;
  finalizeOnBudget?: boolean;
  now?: Date;
}

export type CodexDirectBudgetReason = "turns" | "tool_calls" | "failed_tool_calls";

export interface CodexDirectBudgetSummary {
  reason: CodexDirectBudgetReason;
  maxTurns: number;
  maxToolCalls?: number;
  maxFailedToolCalls?: number;
  toolCalls: number;
  failedToolCalls: number;
}

export type CodexDirectInterruptionSummary =
  | CodexDirectModelTimeoutInterruptionSummary
  | CodexDirectModelRetryExhaustedInterruptionSummary;

export interface CodexDirectModelTimeoutInterruptionSummary {
  reason: "model_timeout";
  timeoutMs: number;
  elapsedMs: number;
  heartbeatCount: number;
  retryCommand: string;
}

export interface CodexDirectModelRetryExhaustedInterruptionSummary {
  reason: "model_request_retries_exhausted";
  phase: CodexDirectModelRequestPhase;
  attempts: number;
  maxRetries: number;
  lastError: string;
  retryCommand: string;
}

export type CodexDirectModelRequestPhase = "conversation" | "final_summary";

type CodexDirectToolName =
  | "list_files"
  | "search_text"
  | "read_file"
  | "read_many_files"
  | "file_info"
  | "tree"
  | "package_scripts"
  | "apply_patch"
  | "run_verifier"
  | "write_file"
  | "run_command"
  | "git_status"
  | "git_diff"
  | "git_log"
  | "git_show"
  | "diff_summary"
  | "read_evidence"
  | "workspace_facts";

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
  const executedToolCalls = 0;
  const failedToolCalls = 0;
  const maxTurns = options.maxTurns ?? DEFAULT_CODEX_DIRECT_MAX_TURNS;

  return runCodexDirectConversation({
    options,
    workerRun,
    messages,
    maxTurns,
    executedToolCalls,
    failedToolCalls
  });
}

async function runCodexDirectConversation(input: {
  options: CodexDirectWorkerOptions;
  workerRun: WorkerRun;
  messages: CodexResponsesInputItem[];
  maxTurns: number;
  executedToolCalls: number;
  failedToolCalls: number;
  warnings?: string[];
}): Promise<CodexDirectWorkerResult> {
  let executedToolCalls = input.executedToolCalls;
  let failedToolCalls = input.failedToolCalls;
  const verifierResults = new Map<string, RuntimeVerificationStatus>();
  const verification = (): RuntimeVerificationStatus =>
    codexDirectVerificationStatus(input.options.task, verifierResults);

  try {
    for (let turn = 0; turn < input.maxTurns; turn += 1) {
      const request: CodexResponsesRequest = {
        model: input.options.model,
        instructions: buildCodexDirectInstructions(input.options),
        input: input.messages,
        tools: codexDirectToolDefinitions(),
        sessionId: input.options.task.id
      };
      const response = await runGovernedModelInference({
        ...input.options,
        workerRun: input.workerRun,
        request
      });

      if (response.toolCalls.length === 0) {
        const summary = response.outputText || "Codex Direct worker completed.";

        return completedWorkerResult({
          options: input.options,
          workerRun: input.workerRun,
          status: "completed",
          exitCode: 0,
          summary,
          toolCalls: executedToolCalls,
          failedToolCalls,
          verification: verification(),
          ...codexDirectWarningOptions(input.warnings)
        });
      }

      for (const rawToolCall of response.toolCalls) {
        if (
          input.options.maxToolCalls !== undefined &&
          executedToolCalls >= input.options.maxToolCalls
        ) {
          return finalizeBudgetExceededWorkerResult({
            options: input.options,
            workerRun: input.workerRun,
            messages: input.messages,
            reason: "tool_calls",
            maxTurns: input.maxTurns,
            toolCalls: executedToolCalls,
            failedToolCalls,
            verification: verification(),
            ...codexDirectWarningOptions(input.warnings)
          });
        }

        const toolCall = parseCodexDirectToolCall(rawToolCall);
        const toolResult = await runCodexDirectTool({
          ...input.options,
          workerRun: input.workerRun,
          toolCall,
          resumeContext: {
            messages: input.messages,
            toolCall: {
              type: "function_call",
              call_id: rawToolCall.id,
              name: rawToolCall.name,
              arguments: rawToolCall.arguments
            }
          }
        });

        executedToolCalls += 1;
        if (toolResult.failed) {
          failedToolCalls += 1;
        }
        recordCodexDirectVerifierResult({
          toolCall,
          toolResult,
          verifierResults
        });
        input.messages.push({
          type: "function_call",
          call_id: rawToolCall.id,
          name: rawToolCall.name,
          arguments: rawToolCall.arguments
        });
        input.messages.push({
          type: "function_call_output",
          call_id: rawToolCall.id,
          output: toolResult.output
        });

        if (
          input.options.maxFailedToolCalls !== undefined &&
          failedToolCalls >= input.options.maxFailedToolCalls
        ) {
          return finalizeBudgetExceededWorkerResult({
            options: input.options,
            workerRun: input.workerRun,
            messages: input.messages,
            reason: "failed_tool_calls",
            maxTurns: input.maxTurns,
            toolCalls: executedToolCalls,
            failedToolCalls,
            verification: verification(),
            ...codexDirectWarningOptions(input.warnings)
          });
        }
      }
    }

    return finalizeBudgetExceededWorkerResult({
      options: input.options,
      workerRun: input.workerRun,
      messages: input.messages,
      reason: "turns",
      maxTurns: input.maxTurns,
      toolCalls: executedToolCalls,
      failedToolCalls,
      verification: verification(),
      ...codexDirectWarningOptions(input.warnings)
    });
  } catch (error) {
    if (error instanceof ToolActionApprovalRequiredError) {
      return completedWorkerResult({
        options: input.options,
        workerRun: input.workerRun,
        status: "waiting_approval",
        exitCode: 2,
        summary: error.message,
        toolCalls: executedToolCalls,
        failedToolCalls,
        verification: verification(),
        ...codexDirectWarningOptions(input.warnings),
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
        options: input.options,
        workerRun: input.workerRun,
        status: "blocked",
        exitCode: 3,
        summary: error.message,
        toolCalls: executedToolCalls,
        failedToolCalls,
        verification: verification(),
        ...codexDirectWarningOptions(input.warnings)
      });
    }

    if (error instanceof CodexDirectModelTimeoutError) {
      return completedWorkerResult({
        options: input.options,
        workerRun: input.workerRun,
        status: "interrupted",
        exitCode: 124,
        summary: error.message,
        toolCalls: executedToolCalls,
        failedToolCalls,
        verification: verification(),
        ...codexDirectWarningOptions([
          ...(input.warnings ?? []),
          "Codex Direct model request timed out; the task is recoverable with runstead resume."
        ]),
        interruption: modelTimeoutInterruption(input.options, error)
      });
    }

    if (error instanceof CodexDirectModelRetryExhaustedError) {
      return completedWorkerResult({
        options: input.options,
        workerRun: input.workerRun,
        status: "failed",
        exitCode: 1,
        summary: error.message,
        toolCalls: executedToolCalls,
        failedToolCalls,
        verification: verification(),
        ...codexDirectWarningOptions([
          ...(input.warnings ?? []),
          "Codex Direct model request retry budget exhausted; the task is recoverable with runstead resume."
        ]),
        interruption: modelRetryExhaustedInterruption(input.options, error)
      });
    }

    return completedWorkerResult({
      options: input.options,
      workerRun: input.workerRun,
      status: "failed",
      exitCode: 1,
      summary: error instanceof Error ? error.message : String(error),
      toolCalls: executedToolCalls,
      failedToolCalls,
      verification: verification(),
      ...codexDirectWarningOptions(input.warnings)
    });
  }
}

export async function runCodexDirectPendingPatchResume(
  options: CodexDirectPendingPatchResumeOptions
): Promise<CodexDirectWorkerResult> {
  const workerRun = startWorkerRun({
    database: options.database,
    task: options.task,
    workerType: CODEX_DIRECT_WORKER_KIND,
    enforcementLevel: "hard_proxy_tool_calls",
    ...(options.now === undefined ? {} : { now: options.now })
  });

  try {
    const governed = await runGovernedToolAction({
      ...governedToolOptions({ ...options, workerRun }),
      action: options.pendingPatch.action,
      run: async () => {
        const value = await applyWorkspacePatch(options.cwd, {
          ...(options.pendingPatch.pendingPatch.patch === undefined
            ? {}
            : { patch: options.pendingPatch.pendingPatch.patch }),
          ...(options.pendingPatch.pendingPatch.replacements === undefined
            ? {}
            : { replacements: options.pendingPatch.pendingPatch.replacements })
        });

        return {
          value,
          output: {
            mode: value.mode,
            filesTouched: value.filesTouched,
            applied: value.applied,
            approvalId: options.pendingPatch.approvalId,
            policyDecisionId: options.pendingPatch.policyDecisionId,
            resume: "approved_pending_patch"
          }
        };
      }
    });
    const output = JSON.stringify({
      mode: governed.value.mode,
      filesTouched: governed.value.filesTouched,
      applied: governed.value.applied,
      approvalId: options.pendingPatch.approvalId,
      policyDecisionId: options.pendingPatch.policyDecisionId,
      resume: "approved_pending_patch"
    });
    const resumeContext = options.pendingPatch.pendingPatch.resumeContext;

    if (resumeContext === undefined || options.transport === undefined) {
      return completedWorkerResult({
        options,
        workerRun,
        status: "completed",
        exitCode: 0,
        summary: "Applied approved pending patch without regenerating model output.",
        toolCalls: 1,
        failedToolCalls: 0,
        warnings: [
          `Resumed from approved pending patch ${options.pendingPatch.approvalId}.`,
          ...(resumeContext === undefined
            ? [
                "Approved patch lacked durable conversation context; model loop continuation was skipped."
              ]
            : []),
          ...(options.transport === undefined
            ? [
                "Codex Direct transport was unavailable; model loop continuation was skipped."
              ]
            : [])
        ]
      });
    }

    return runCodexDirectConversation({
      options: {
        ...options,
        transport: options.transport,
        modelProviderNetworkDomains: options.modelProviderNetworkDomains ?? [
          "chatgpt.com"
        ]
      },
      workerRun,
      messages: [
        ...resumeContext.messages,
        resumeContext.toolCall,
        {
          type: "function_call_output",
          call_id: resumeContext.toolCall.call_id,
          output
        }
      ],
      maxTurns: options.maxTurns ?? DEFAULT_CODEX_DIRECT_MAX_TURNS,
      executedToolCalls: 1,
      failedToolCalls: 0,
      warnings: [
        `Resumed from approved pending patch ${options.pendingPatch.approvalId}.`,
        "Continued the Codex Direct model loop from the approved tool call."
      ]
    });
  } catch (error) {
    if (error instanceof ToolActionApprovalRequiredError) {
      return completedWorkerResult({
        options,
        workerRun,
        status: "waiting_approval",
        exitCode: 2,
        summary: error.message,
        toolCalls: 1,
        failedToolCalls: 0,
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
        toolCalls: 1,
        failedToolCalls: 0
      });
    }

    if (error instanceof CodexDirectModelTimeoutError) {
      return completedWorkerResult({
        options,
        workerRun,
        status: "interrupted",
        exitCode: 124,
        summary: error.message,
        toolCalls: 1,
        failedToolCalls: 0,
        warnings: [
          `Resumed from approved pending patch ${options.pendingPatch.approvalId}.`,
          "Codex Direct model request timed out; the task is recoverable with runstead resume."
        ],
        interruption: modelTimeoutInterruption(options, error)
      });
    }

    return completedWorkerResult({
      options,
      workerRun,
      status: "failed",
      exitCode: 1,
      summary: error instanceof Error ? error.message : String(error),
      toolCalls: 1,
      failedToolCalls: 1
    });
  }
}

export function readApprovedCodexDirectPendingPatch(
  database: RunsteadDatabase,
  approvalId: string
): CodexDirectPendingPatchResume | undefined {
  const row = database
    .prepare(
      `
      SELECT a.id AS approval_id, a.status, a.policy_decision_id, pd.action_json
      FROM approvals a
      JOIN policy_decisions pd ON pd.id = a.policy_decision_id
      WHERE a.id = ?
    `
    )
    .get(approvalId) as
    | {
        approval_id: string;
        status: string;
        policy_decision_id: string;
        action_json: string;
      }
    | undefined;

  if (row === undefined) {
    return undefined;
  }

  const action = parsePendingPatchAction(row.action_json);

  if (action === undefined) {
    return undefined;
  }

  if (row.status !== "approved") {
    return readApprovedCodexDirectPendingPatchBySignature(
      database,
      action.context.pendingPatch.canonicalSignature
    );
  }

  return {
    approvalId: row.approval_id,
    policyDecisionId: row.policy_decision_id,
    action,
    pendingPatch: action.context.pendingPatch
  };
}

function readApprovedCodexDirectPendingPatchBySignature(
  database: RunsteadDatabase,
  canonicalSignature: string
): CodexDirectPendingPatchResume | undefined {
  const rows = database
    .prepare(
      `
      SELECT a.id AS approval_id, a.policy_decision_id, pd.action_json
      FROM approvals a
      JOIN policy_decisions pd ON pd.id = a.policy_decision_id
      WHERE a.status = 'approved'
      ORDER BY a.updated_at DESC, a.id DESC
      LIMIT 50
    `
    )
    .all() as {
    approval_id: string;
    policy_decision_id: string;
    action_json: string;
  }[];

  for (const row of rows) {
    const action = parsePendingPatchAction(row.action_json);

    if (action?.context.pendingPatch.canonicalSignature !== canonicalSignature) {
      continue;
    }

    return {
      approvalId: row.approval_id,
      policyDecisionId: row.policy_decision_id,
      action,
      pendingPatch: action.context.pendingPatch
    };
  }

  return undefined;
}

async function runGovernedModelInference(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    request: CodexResponsesRequest;
    phase?: CodexDirectModelRequestPhase;
  }
): Promise<CodexResponsesResult> {
  const phase = options.phase ?? "conversation";

  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: modelInferenceAction({
      task: options.task,
      model: options.model,
      ...(options.modelProviderResourceId === undefined
        ? {}
        : { providerResourceId: options.modelProviderResourceId }),
      ...(options.modelProviderNetworkDomains === undefined
        ? {}
        : { networkDomains: options.modelProviderNetworkDomains })
    }),
    run: async () => {
      const modelRequest = await runModelRequestWithHeartbeat({
        database: options.database,
        task: options.task,
        workerRun: options.workerRun,
        phase,
        timeoutMs: modelRequestTimeoutMs(options, phase),
        heartbeatMs:
          options.modelRequestHeartbeatMs ??
          DEFAULT_CODEX_DIRECT_MODEL_REQUEST_HEARTBEAT_MS,
        maxRetries:
          options.modelRequestMaxRetries ??
          DEFAULT_CODEX_DIRECT_MODEL_REQUEST_MAX_RETRIES,
        retryBaseDelayMs:
          options.modelRequestRetryBaseDelayMs ??
          DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_BASE_DELAY_MS,
        retryMaxDelayMs:
          options.modelRequestRetryMaxDelayMs ??
          DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_MAX_DELAY_MS,
        retryJitterMs:
          options.modelRequestRetryJitterMs ??
          DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_JITTER_MS,
        request: () => options.transport.createResponse(options.request)
      });
      const value = modelRequest.value;

      return {
        value,
        output: {
          model: options.model,
          status: value.status ?? "unknown",
          finishReason: value.finishReason,
          phase,
          elapsedMs: modelRequest.elapsedMs,
          heartbeatCount: modelRequest.heartbeatCount,
          attempts: modelRequest.attempts,
          retryCount: modelRequest.retryCount,
          toolCalls: value.toolCalls.length,
          outputTextBytes: Buffer.byteLength(value.outputText, "utf8")
        }
      };
    }
  }).then((result) => result.value);
}

function modelRequestTimeoutMs(
  options: CodexDirectWorkerOptions,
  phase: CodexDirectModelRequestPhase
): number {
  const defaultTimeout =
    phase === "final_summary"
      ? DEFAULT_CODEX_DIRECT_FINAL_SUMMARY_REQUEST_TIMEOUT_MS
      : DEFAULT_CODEX_DIRECT_MODEL_REQUEST_TIMEOUT_MS;
  const configured =
    phase === "final_summary"
      ? options.modelFinalSummaryRequestTimeoutMs ?? options.modelRequestTimeoutMs
      : options.modelRequestTimeoutMs;

  return configured ?? defaultTimeout;
}

async function runModelRequestWithHeartbeat(input: {
  database: RunsteadDatabase;
  task: Task;
  workerRun: WorkerRun;
  phase: CodexDirectModelRequestPhase;
  timeoutMs: number;
  heartbeatMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  retryJitterMs: number;
  request: () => Promise<CodexResponsesResult>;
}): Promise<{
  value: CodexResponsesResult;
  elapsedMs: number;
  heartbeatCount: number;
  attempts: number;
  retryCount: number;
}> {
  const startedAt = Date.now();
  let attempts = 0;
  let retryCount = 0;
  let heartbeatCount = 0;

  const recordHeartbeat = (stage: "started" | "waiting"): void => {
    heartbeatCount += 1;
    recordModelRequestHeartbeat({
      database: input.database,
      task: input.task,
      workerRun: input.workerRun,
      sequence: heartbeatCount,
      stage,
      phase: input.phase,
      elapsedMs: Date.now() - startedAt,
      timeoutMs: input.timeoutMs
    });
  };

  while (true) {
    attempts += 1;

    try {
      const value = await runSingleModelRequestWithHeartbeat({
        timeoutMs: input.timeoutMs,
        heartbeatMs: input.heartbeatMs,
        request: input.request,
        recordHeartbeat,
        currentElapsedMs: () => Date.now() - startedAt,
        heartbeatCount: () => heartbeatCount
      });

      return {
        value,
        elapsedMs: Date.now() - startedAt,
        heartbeatCount,
        attempts,
        retryCount
      };
    } catch (error) {
      if (
        attempts > input.maxRetries ||
        !isTransientModelRequestError(error)
      ) {
        if (retryCount > 0 && isTransientModelRequestError(error)) {
          throw new CodexDirectModelRetryExhaustedError({
            phase: input.phase,
            attempts,
            maxRetries: input.maxRetries,
            lastError: errorMessage(error)
          });
        }

        throw error;
      }

      retryCount += 1;
      const delayMs = modelRequestRetryDelayMs({
        retryCount,
        baseDelayMs: input.retryBaseDelayMs,
        maxDelayMs: input.retryMaxDelayMs,
        jitterMs: input.retryJitterMs
      });

      recordModelRequestRetry({
        database: input.database,
        task: input.task,
        workerRun: input.workerRun,
        phase: input.phase,
        attempt: attempts,
        nextAttempt: attempts + 1,
        maxRetries: input.maxRetries,
        reason: errorMessage(error),
        delayMs,
        elapsedMs: Date.now() - startedAt
      });
      await sleep(delayMs);
    }
  }
}

async function runSingleModelRequestWithHeartbeat(input: {
  timeoutMs: number;
  heartbeatMs: number;
  request: () => Promise<CodexResponsesResult>;
  recordHeartbeat: (stage: "started" | "waiting") => void;
  currentElapsedMs: () => number;
  heartbeatCount: () => number;
}): Promise<CodexResponsesResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  input.recordHeartbeat("started");

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(
        new CodexDirectModelTimeoutError({
          timeoutMs: input.timeoutMs,
          elapsedMs: input.currentElapsedMs(),
          heartbeatCount: input.heartbeatCount()
        })
      );
    }, input.timeoutMs);
    timeout.unref?.();
  });

  if (input.heartbeatMs > 0) {
    heartbeat = setInterval(() => {
      input.recordHeartbeat("waiting");
    }, input.heartbeatMs);
    heartbeat.unref?.();
  }

  try {
    return await Promise.race([input.request(), timeoutPromise]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (heartbeat !== undefined) {
      clearInterval(heartbeat);
    }
  }
}

function recordModelRequestHeartbeat(input: {
  database: RunsteadDatabase;
  task: Task;
  workerRun: WorkerRun;
  sequence: number;
  stage: "started" | "waiting";
  phase: CodexDirectModelRequestPhase;
  elapsedMs: number;
  timeoutMs: number;
}): void {
  const heartbeatAt = new Date().toISOString();
  const leaseExpiresAt = new Date(Date.now() + EXECUTION_LEASE_MS).toISOString();

  appendEventAndProject(input.database, {
    event: {
      eventId: createRunsteadId("evt"),
      type: "worker_run.heartbeat",
      aggregateType: "worker_run",
      aggregateId: input.workerRun.id,
      payload: {
        workerRunId: input.workerRun.id,
        taskId: input.task.id,
        phase: "model_inference_request",
        requestPhase: input.phase,
        stage: input.stage,
        sequence: input.sequence,
        elapsedMs: input.elapsedMs,
        timeoutMs: input.timeoutMs
      },
      createdAt: heartbeatAt
    }
  });
  input.database
    .prepare(
      `
      UPDATE worker_runs
      SET heartbeat_at = ?, lease_expires_at = ?
      WHERE id = ? AND status = 'running'
    `
    )
    .run(heartbeatAt, leaseExpiresAt, input.workerRun.id);
  input.database
    .prepare(
      `
      UPDATE tasks
      SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = 'running'
    `
    )
    .run(heartbeatAt, leaseExpiresAt, heartbeatAt, input.task.id);
}

function recordModelRequestRetry(input: {
  database: RunsteadDatabase;
  task: Task;
  workerRun: WorkerRun;
  phase: CodexDirectModelRequestPhase;
  attempt: number;
  nextAttempt: number;
  maxRetries: number;
  reason: string;
  delayMs: number;
  elapsedMs: number;
}): void {
  const createdAt = new Date().toISOString();

  appendEventAndProject(input.database, {
    event: {
      eventId: createRunsteadId("evt"),
      type: "model_request.retry",
      aggregateType: "worker_run",
      aggregateId: input.workerRun.id,
      payload: {
        workerRunId: input.workerRun.id,
        taskId: input.task.id,
        phase: input.phase,
        attempt: input.attempt,
        nextAttempt: input.nextAttempt,
        maxRetries: input.maxRetries,
        reason: input.reason,
        delayMs: input.delayMs,
        elapsedMs: input.elapsedMs
      },
      createdAt
    }
  });
}

function modelRequestRetryDelayMs(input: {
  retryCount: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
}): number {
  const exponential = input.baseDelayMs * 2 ** Math.max(0, input.retryCount - 1);
  const capped = Math.min(exponential, input.maxDelayMs);
  const jitter =
    input.jitterMs <= 0 ? 0 : Math.floor(Math.random() * (input.jitterMs + 1));

  return Math.max(0, capped + jitter);
}

function isTransientModelRequestError(error: unknown): boolean {
  if (error instanceof CodexDirectModelTimeoutError) {
    return false;
  }

  const message = errorMessage(error).toLowerCase();
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
  const transientNeedles = [
    "fetch failed",
    "network",
    "socket hang up",
    "connection reset",
    "temporarily unavailable",
    "timeout",
    "timed out",
    "econnreset",
    "etimedout",
    "econnrefused",
    "enotfound",
    "eai_again",
    "503",
    "502",
    "504",
    "429"
  ];

  return transientNeedles.some((needle) =>
    `${message} ${code.toLowerCase()}`.includes(needle)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    timeout.unref?.();
  });
}

class CodexDirectModelTimeoutError extends Error {
  readonly reason = "model_timeout";
  readonly timeoutMs: number;
  readonly elapsedMs: number;
  readonly heartbeatCount: number;

  constructor(input: { timeoutMs: number; elapsedMs: number; heartbeatCount: number }) {
    super(
      `Codex Direct model request timed out after ${input.timeoutMs}ms; runstead marked the task interrupted:model_timeout.`
    );
    this.timeoutMs = input.timeoutMs;
    this.elapsedMs = input.elapsedMs;
    this.heartbeatCount = input.heartbeatCount;
  }
}

class CodexDirectModelRetryExhaustedError extends Error {
  readonly reason = "model_request_retries_exhausted";
  readonly phase: CodexDirectModelRequestPhase;
  readonly attempts: number;
  readonly maxRetries: number;
  readonly lastError: string;

  constructor(input: {
    phase: CodexDirectModelRequestPhase;
    attempts: number;
    maxRetries: number;
    lastError: string;
  }) {
    super(
      `Codex Direct model request retry budget exhausted after ${input.attempts} attempts in ${input.phase}: ${input.lastError}`
    );
    this.phase = input.phase;
    this.attempts = input.attempts;
    this.maxRetries = input.maxRetries;
    this.lastError = input.lastError;
  }
}

function modelTimeoutInterruption(
  options: Pick<CodexDirectWorkerOptions, "task">,
  error: CodexDirectModelTimeoutError
): CodexDirectInterruptionSummary {
  return {
    reason: error.reason,
    timeoutMs: error.timeoutMs,
    elapsedMs: error.elapsedMs,
    heartbeatCount: error.heartbeatCount,
    retryCommand: `runstead resume && runstead agent resume ${options.task.id}`
  };
}

function modelRetryExhaustedInterruption(
  options: Pick<CodexDirectWorkerOptions, "task">,
  error: CodexDirectModelRetryExhaustedError
): CodexDirectInterruptionSummary {
  return {
    reason: error.reason,
    phase: error.phase,
    attempts: error.attempts,
    maxRetries: error.maxRetries,
    lastError: error.lastError,
    retryCommand: `runstead resume && runstead agent resume ${options.task.id}`
  };
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
      name: "list_files",
      description:
        "List workspace files with stable relative paths, glob filters, default repository ignores, and bounded output.",
      strict: false,
      parameters: objectSchema(
        {
          glob: {
            oneOf: [
              {
                type: "string"
              },
              {
                type: "array",
                items: {
                  type: "string"
                }
              }
            ],
            description:
              "Optional glob pattern or patterns. Defaults to all non-ignored files."
          },
          exclude: {
            type: "array",
            items: {
              type: "string"
            },
            description: "Optional glob patterns to exclude."
          },
          maxResults: {
            type: "number",
            description: "Optional maximum number of entries to return."
          },
          includeDirs: {
            type: "boolean",
            description: "Include directory entries when true."
          }
        },
        []
      )
    },
    {
      type: "function",
      name: "search_text",
      description:
        "Search workspace text with bounded structured results. Returns path, line, and preview for each match.",
      strict: false,
      parameters: objectSchema(
        {
          query: {
            type: "string",
            description: "Text or regular expression to search for."
          },
          regex: {
            type: "boolean",
            description: "Treat query as a regular expression when true."
          },
          glob: {
            oneOf: [
              {
                type: "string"
              },
              {
                type: "array",
                items: {
                  type: "string"
                }
              }
            ],
            description: "Optional file glob or globs to search."
          },
          caseSensitive: {
            type: "boolean",
            description: "Use case-sensitive matching when true."
          },
          contextLines: {
            type: "number",
            description: "Optional surrounding line count per match."
          },
          maxMatches: {
            type: "number",
            description: "Optional maximum number of matches to return."
          },
          maxBytesPerFile: {
            type: "number",
            description: "Optional maximum bytes scanned per file."
          }
        },
        ["query"]
      )
    },
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
      name: "read_many_files",
      description:
        "Read multiple UTF-8 files inside the workspace with per-file and total byte limits.",
      strict: false,
      parameters: objectSchema(
        {
          paths: {
            type: "array",
            items: {
              type: "string"
            },
            description: "Workspace-relative file paths."
          },
          maxBytesPerFile: {
            type: "number",
            description: "Optional maximum bytes returned for each file."
          },
          maxTotalBytes: {
            type: "number",
            description: "Optional maximum bytes returned across all files."
          }
        },
        ["paths"]
      )
    },
    {
      type: "function",
      name: "file_info",
      description:
        "Return file or directory metadata including size, mtime, binary hint, and directory summary.",
      strict: false,
      parameters: objectSchema(
        {
          path: {
            type: "string",
            description: "Workspace-relative path. Defaults to the workspace root."
          },
          maxEntries: {
            type: "number",
            description:
              "Optional maximum child entries to include for directory summaries."
          }
        },
        []
      )
    },
    {
      type: "function",
      name: "tree",
      description:
        "Return a bounded tree view rooted at a workspace-relative directory path.",
      strict: false,
      parameters: objectSchema(
        {
          path: {
            type: "string",
            description: "Workspace-relative directory path. Defaults to root."
          },
          maxDepth: {
            type: "number",
            description: "Optional maximum tree depth."
          },
          maxEntries: {
            type: "number",
            description: "Optional maximum entries returned."
          },
          includeFiles: {
            type: "boolean",
            description: "Include file entries. Defaults to true."
          }
        },
        []
      )
    },
    {
      type: "function",
      name: "package_scripts",
      description:
        "Inspect package.json scripts, package manager, workspace hints, turbo tasks, and verifier command candidates.",
      strict: false,
      parameters: objectSchema(
        {
          path: {
            type: "string",
            description:
              "Workspace-relative package directory. Defaults to the workspace root."
          }
        },
        []
      )
    },
    {
      type: "function",
      name: "apply_patch",
      description:
        "Apply a unified diff or structured text replacements inside the workspace.",
      strict: false,
      parameters: objectSchema(
        {
          patch: {
            type: "string",
            description: "Unified diff to apply."
          },
          replacements: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: {
                  type: "string"
                },
                search: {
                  type: "string"
                },
                replace: {
                  type: "string"
                },
                replaceAll: {
                  type: "boolean"
                }
              },
              required: ["path", "search", "replace"],
              additionalProperties: false
            },
            description: "Structured search/replace edits to apply."
          }
        },
        []
      )
    },
    {
      type: "function",
      name: "run_verifier",
      description:
        "Run one declared or auto-discovered verifier command and record evidence.",
      strict: false,
      parameters: objectSchema(
        {
          name: {
            type: "string",
            description: "Verifier name, such as test, lint, or typecheck."
          },
          timeoutMs: {
            type: "number",
            description: "Optional verifier timeout in milliseconds."
          }
        },
        ["name"]
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
          },
          staged: {
            type: "boolean",
            description: "Return the staged diff when true."
          },
          base: {
            type: "string",
            description: "Optional base ref for base...HEAD diffs."
          }
        },
        []
      )
    },
    {
      type: "function",
      name: "git_log",
      description: "Return bounded git commit history for the workspace.",
      strict: false,
      parameters: objectSchema(
        {
          range: {
            type: "string",
            description: "Optional git revision range."
          },
          path: {
            type: "string",
            description: "Optional workspace-relative path to filter history."
          },
          maxCommits: {
            type: "number",
            description: "Optional maximum commits to return."
          }
        },
        []
      )
    },
    {
      type: "function",
      name: "git_show",
      description: "Return bounded git show output for a commit or ref.",
      strict: false,
      parameters: objectSchema(
        {
          ref: {
            type: "string",
            description: "Commit or ref to show."
          },
          path: {
            type: "string",
            description: "Optional workspace-relative path to show."
          },
          maxBytes: {
            type: "number",
            description: "Optional maximum stdout/stderr bytes to capture."
          }
        },
        ["ref"]
      )
    },
    {
      type: "function",
      name: "diff_summary",
      description:
        "Return a bounded file-level summary of the workspace git diff without full patch contents.",
      strict: false,
      parameters: objectSchema(
        {
          path: {
            type: "string",
            description: "Optional workspace-relative path to summarize."
          },
          staged: {
            type: "boolean",
            description: "Summarize staged diff when true."
          },
          base: {
            type: "string",
            description: "Optional base ref for base...HEAD summaries."
          },
          maxFiles: {
            type: "number",
            description: "Optional maximum file rows to return."
          }
        },
        []
      )
    },
    {
      type: "function",
      name: "read_evidence",
      description:
        "Read a Runstead evidence record and bounded local artifact contents by evidence id.",
      strict: false,
      parameters: objectSchema(
        {
          id: {
            type: "string",
            description: "Runstead evidence id."
          },
          maxBytes: {
            type: "number",
            description: "Optional maximum artifact bytes to return."
          }
        },
        ["id"]
      )
    },
    {
      type: "function",
      name: "workspace_facts",
      description:
        "Return cached structured workspace facts, refreshing repo inspection evidence when requested.",
      strict: false,
      parameters: objectSchema(
        {
          refresh: {
            type: "boolean",
            description:
              "Collect fresh workspace facts instead of using cached evidence."
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
    resumeContext?: CodexDirectPendingToolResumeContext;
  }
): Promise<{ output: string; failed: boolean }> {
  try {
    return {
      output: await executeCodexDirectTool(options),
      failed: false
    };
  } catch (error) {
    if (
      error instanceof ToolActionApprovalRequiredError ||
      error instanceof ToolActionDeniedError
    ) {
      throw error;
    }

    return {
      output: JSON.stringify(toolExecutionErrorOutput(error)),
      failed: true
    };
  }
}

async function executeCodexDirectTool(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    toolCall: CodexDirectToolCall;
    resumeContext?: CodexDirectPendingToolResumeContext;
  }
): Promise<string> {
  switch (options.toolCall.name) {
    case "list_files":
      return JSON.stringify(
        await runGovernedListFiles({
          ...options,
          ...optionalField(
            "glob",
            optionalStringArray(options.toolCall.arguments.glob, "glob")
          ),
          ...optionalField(
            "exclude",
            optionalStringArray(options.toolCall.arguments.exclude, "exclude")
          ),
          ...optionalField(
            "maxResults",
            optionalPositiveInteger(options.toolCall.arguments.maxResults)
          ),
          includeDirs: options.toolCall.arguments.includeDirs === true
        })
      );
    case "search_text":
      return JSON.stringify(
        await runGovernedSearchText({
          ...options,
          query: requiredString(options.toolCall.arguments.query, "query"),
          regex: options.toolCall.arguments.regex === true,
          ...optionalField(
            "glob",
            optionalStringArray(options.toolCall.arguments.glob, "glob")
          ),
          caseSensitive: options.toolCall.arguments.caseSensitive === true,
          ...optionalField(
            "contextLines",
            optionalNonNegativeInteger(
              options.toolCall.arguments.contextLines,
              "contextLines"
            )
          ),
          ...optionalField(
            "maxMatches",
            optionalPositiveInteger(options.toolCall.arguments.maxMatches)
          ),
          ...optionalField(
            "maxBytesPerFile",
            optionalPositiveInteger(options.toolCall.arguments.maxBytesPerFile)
          )
        })
      );
    case "read_file":
      return JSON.stringify(
        await readGovernedWorkspaceFile({
          ...governedToolOptions(options),
          path: requiredString(options.toolCall.arguments.path, "path")
        }).then((result) => result.value)
      );
    case "read_many_files":
      return JSON.stringify(
        await runGovernedReadManyFiles({
          ...options,
          paths: requiredStringArray(options.toolCall.arguments.paths, "paths"),
          ...optionalField(
            "maxBytesPerFile",
            optionalPositiveInteger(options.toolCall.arguments.maxBytesPerFile)
          ),
          ...optionalField(
            "maxTotalBytes",
            optionalPositiveInteger(options.toolCall.arguments.maxTotalBytes)
          )
        })
      );
    case "file_info":
      return JSON.stringify(
        await runGovernedFileInfo({
          ...options,
          path: optionalString(options.toolCall.arguments.path) ?? ".",
          ...optionalField(
            "maxEntries",
            optionalPositiveInteger(options.toolCall.arguments.maxEntries)
          )
        })
      );
    case "tree":
      return JSON.stringify(
        await runGovernedTree({
          ...options,
          path: optionalString(options.toolCall.arguments.path) ?? ".",
          ...optionalField(
            "maxDepth",
            optionalPositiveInteger(options.toolCall.arguments.maxDepth)
          ),
          ...optionalField(
            "maxEntries",
            optionalPositiveInteger(options.toolCall.arguments.maxEntries)
          ),
          includeFiles: options.toolCall.arguments.includeFiles !== false
        })
      );
    case "package_scripts":
      return JSON.stringify(
        await runGovernedPackageScripts({
          ...options,
          path: optionalString(options.toolCall.arguments.path) ?? "."
        })
      );
    case "apply_patch":
      return JSON.stringify(
        await runGovernedApplyPatch({
          ...options,
          ...optionalField("patch", optionalString(options.toolCall.arguments.patch)),
          ...optionalField(
            "replacements",
            optionalReplacementArray(options.toolCall.arguments.replacements)
          )
        })
      );
    case "run_verifier":
      return JSON.stringify(
        await runGovernedVerifier({
          ...options,
          name: requiredString(options.toolCall.arguments.name, "name"),
          ...optionalTimeoutMs(options.toolCall.arguments.timeoutMs)
        })
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
      const requestedStaged = options.toolCall.arguments.staged === true;
      const staged = taskGitDiffStaged(options.task) ?? requestedStaged;
      const base =
        taskGitDiffBase(options.task) ??
        optionalString(options.toolCall.arguments.base);
      const command = gitDiffCommand({ path, staged, base });

      return JSON.stringify(await runGovernedGitRead(options, command));
    }
    case "git_log":
      return JSON.stringify(
        await runGovernedGitLog({
          ...options,
          ...optionalField("range", optionalString(options.toolCall.arguments.range)),
          ...optionalField("path", optionalString(options.toolCall.arguments.path)),
          ...optionalField(
            "maxCommits",
            optionalPositiveInteger(options.toolCall.arguments.maxCommits)
          )
        })
      );
    case "git_show":
      return JSON.stringify(
        await runGovernedGitShow({
          ...options,
          ref: requiredString(options.toolCall.arguments.ref, "ref"),
          ...optionalField("path", optionalString(options.toolCall.arguments.path)),
          ...optionalField(
            "maxBytes",
            optionalPositiveInteger(options.toolCall.arguments.maxBytes)
          )
        })
      );
    case "diff_summary": {
      const path = optionalString(options.toolCall.arguments.path);
      const requestedStaged = options.toolCall.arguments.staged === true;
      const staged = taskGitDiffStaged(options.task) ?? requestedStaged;
      const base =
        taskGitDiffBase(options.task) ??
        optionalString(options.toolCall.arguments.base);

      return JSON.stringify(
        await runGovernedDiffSummary({
          ...options,
          staged,
          ...optionalField("path", path),
          ...optionalField("base", base),
          ...optionalField(
            "maxFiles",
            optionalPositiveInteger(options.toolCall.arguments.maxFiles)
          )
        })
      );
    }
    case "read_evidence":
      return JSON.stringify(
        await runGovernedReadEvidence({
          ...options,
          id: requiredString(options.toolCall.arguments.id, "id"),
          ...optionalField(
            "maxBytes",
            optionalPositiveInteger(options.toolCall.arguments.maxBytes)
          )
        })
      );
    case "workspace_facts":
      return JSON.stringify(
        await runGovernedWorkspaceFacts({
          ...options,
          refresh: options.toolCall.arguments.refresh === true
        })
      );
  }
}

async function runGovernedWorkspaceFacts(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    refresh: boolean;
  }
) {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: workspaceFactsReadAction({
      cwd: options.cwd,
      refresh: options.refresh
    }),
    run: async () => {
      const value = await readWorkspaceFacts({
        cwd: options.cwd,
        evidenceDir: options.evidenceDir,
        database: options.database,
        refresh: options.refresh,
        ...(options.now === undefined ? {} : { now: options.now })
      });

      return {
        value,
        output: {
          cached: value.cached,
          evidenceId: value.evidence.id,
          gitDetected: value.facts.git.isGitRepo,
          packageManager: value.facts.packageManager.packageManager ?? "none"
        }
      };
    }
  }).then((result) => result.value);
}

async function runGovernedReadEvidence(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    id: string;
    maxBytes?: number;
  }
) {
  const maxBytes = Math.min(options.maxBytes ?? 64 * 1024, 1024 * 1024);

  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: evidenceReadAction({
      cwd: options.cwd,
      evidenceId: options.id
    }),
    run: async () => {
      const value = await readEvidenceArtifact({
        database: options.database,
        evidenceId: options.id,
        maxBytes
      });

      return {
        value,
        output: {
          evidenceId: value.evidence.id,
          type: value.evidence.type,
          artifactBytes: value.artifact?.bytes ?? 0,
          returnedBytes: value.artifact?.returnedBytes ?? 0,
          truncated: value.artifact?.truncated ?? false
        }
      };
    }
  }).then((result) => result.value);
}

async function runGovernedDiffSummary(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    path?: string;
    staged: boolean;
    base?: string;
    maxFiles?: number;
  }
) {
  const maxFiles = Math.min(options.maxFiles ?? 100, 1_000);
  const input = {
    path: options.path,
    staged: options.staged,
    base: options.base
  };
  const numstatCommand = gitDiffSummaryCommand("--numstat", input);
  const nameStatusCommand = gitDiffSummaryCommand("--name-status", input);
  const shortstatCommand = gitDiffSummaryCommand("--shortstat", input);

  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: gitReadAction({
      cwd: options.cwd,
      actionType: "git.diff.summary"
    }),
    run: async () => {
      const [numstat, nameStatus, shortstat] = await Promise.all([
        runShellCommand({
          command: numstatCommand,
          cwd: options.cwd
        }),
        runShellCommand({
          command: nameStatusCommand,
          cwd: options.cwd
        }),
        runShellCommand({
          command: shortstatCommand,
          cwd: options.cwd
        })
      ]);
      const files = mergeDiffSummaryRows({
        numstat: numstat.stdout,
        nameStatus: nameStatus.stdout
      });
      const truncated = files.length > maxFiles;
      const value = {
        commands: {
          numstat: numstatCommand,
          nameStatus: nameStatusCommand,
          shortstat: shortstatCommand
        },
        exitCode: firstNonZeroExitCode([numstat, nameStatus, shortstat]),
        files: files.slice(0, maxFiles),
        totals: diffSummaryTotals(files),
        shortstat: shortstat.stdout.trim(),
        truncated,
        maxFiles
      };

      return {
        value,
        output: {
          files: value.files.length,
          truncated,
          additions: value.totals.additions,
          deletions: value.totals.deletions,
          shortstat: value.shortstat
        }
      };
    }
  }).then((result) => result.value);
}

async function runGovernedGitLog(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    range?: string;
    path?: string;
    maxCommits?: number;
  }
) {
  const maxCommits = Math.min(options.maxCommits ?? 20, 100);
  const command = gitLogCommand({
    range: options.range,
    path: options.path,
    maxCommits
  });

  return runGovernedGitCommand({
    ...options,
    actionType: "git.log",
    command,
    output: (result) => ({
      command,
      exitCode: result.exitCode,
      stderr: result.stderr,
      commits: parseGitLogOutput(result.stdout),
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated
    })
  });
}

async function runGovernedGitShow(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    ref: string;
    path?: string;
    maxBytes?: number;
  }
) {
  const command = gitShowCommand({
    ref: options.ref,
    path: options.path
  });

  return runGovernedGitCommand({
    ...options,
    actionType: "git.show",
    command,
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    output: (result) => ({
      command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated
    })
  });
}

async function runGovernedVerifier(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    name: string;
    timeoutMs?: number;
  }
) {
  const command = await resolveVerifierCommand(options);

  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: verifierRunAction({
      task: options.task,
      cwd: options.cwd,
      command
    }),
    run: async () => {
      const value = await storeCommandVerifierEvidence({
        cwd: options.cwd,
        runsteadRoot: dirname(options.evidenceDir),
        database: options.database,
        task: options.task,
        command,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.now === undefined ? {} : { now: options.now })
      });

      return {
        value: {
          verifier: command.name,
          command: value.artifact.command,
          exitCode: value.artifact.result.exitCode,
          timedOut: value.artifact.result.timedOut,
          forceKilled: value.artifact.result.forceKilled,
          evidenceId: value.evidence.id,
          artifactPath: value.artifactPath,
          stdoutPreview: previewText(value.artifact.result.stdout),
          stderrPreview: previewText(value.artifact.result.stderr),
          stdoutTruncated: value.artifact.result.stdoutTruncated,
          stderrTruncated: value.artifact.result.stderrTruncated
        },
        output: {
          verifier: command.name,
          exitCode: value.artifact.result.exitCode,
          timedOut: value.artifact.result.timedOut,
          evidenceId: value.evidence.id,
          artifactPath: value.artifactPath
        }
      };
    }
  }).then((result) => result.value);
}

async function runGovernedApplyPatch(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    resumeContext?: CodexDirectPendingToolResumeContext;
    patch?: string;
    replacements?: {
      path: string;
      search: string;
      replace: string;
      replaceAll?: boolean;
    }[];
  }
) {
  const filesTouched = codexDirectPatchFilesTouched(options);
  const approvalMetadata = codexDirectPatchApprovalMetadata({
    cwd: options.cwd,
    task: options.task,
    filesTouched,
    ...(options.patch === undefined ? {} : { patch: options.patch }),
    ...(options.replacements === undefined
      ? {}
      : { replacements: options.replacements })
  });

  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: filesystemPatchAction({
      cwd: options.cwd,
      filesTouched,
      approvalMetadata,
      pendingPatch: codexDirectPendingPatchPayload({
        filesTouched,
        approvalMetadata,
        ...(options.resumeContext === undefined
          ? {}
          : { resumeContext: options.resumeContext }),
        ...(options.patch === undefined ? {} : { patch: options.patch }),
        ...(options.replacements === undefined
          ? {}
          : { replacements: options.replacements })
      }),
      stableParts: [options.cwd, options.patch, options.replacements ?? []]
    }),
    run: async () => {
      const value = await applyWorkspacePatch(options.cwd, {
        ...(options.patch === undefined ? {} : { patch: options.patch }),
        ...(options.replacements === undefined
          ? {}
          : { replacements: options.replacements })
      });

      return {
        value,
        output: {
          mode: value.mode,
          filesTouched: value.filesTouched,
          applied: value.applied
        }
      };
    }
  }).then((result) => result.value);
}

async function runGovernedPackageScripts(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    path: string;
  }
) {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: repositoryMetadataReadAction({
      cwd: options.cwd,
      path: options.path
    }),
    run: async () => {
      const value = await inspectPackageScripts(options.cwd, {
        path: options.path
      });

      return {
        value,
        output: {
          path: value.path,
          packageManager: value.packageManager,
          scripts: value.scripts.length,
          verifierCandidates: value.verifierCandidates.length,
          turboTasks: value.workspace.turboTasks.length
        }
      };
    }
  }).then((result) => result.value);
}

async function runGovernedFileInfo(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    path: string;
    maxEntries?: number;
  }
) {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: filesystemReadAction({
      cwd: options.cwd,
      actionType: "filesystem.stat",
      path: options.path,
      stableParts: [options.cwd, options.path, options.maxEntries]
    }),
    run: async () => {
      const value = await inspectWorkspacePath(options.cwd, {
        path: options.path,
        ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries })
      });

      return {
        value,
        output: {
          path: value.path,
          type: value.type,
          bytes: value.bytes,
          ...(value.directory === undefined
            ? {}
            : {
                entries: value.directory.entries.length,
                truncated: value.directory.truncated
              })
        }
      };
    }
  }).then((result) => result.value);
}

async function runGovernedTree(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    path: string;
    maxDepth?: number;
    maxEntries?: number;
    includeFiles: boolean;
  }
) {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: filesystemReadAction({
      cwd: options.cwd,
      actionType: "filesystem.list",
      path: options.path,
      stableParts: [
        options.cwd,
        options.path,
        options.maxDepth,
        options.maxEntries,
        options.includeFiles
      ]
    }),
    run: async () => {
      const value = await workspaceTree(options.cwd, {
        path: options.path,
        ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
        ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
        includeFiles: options.includeFiles
      });

      return {
        value,
        output: {
          path: value.path,
          entries: value.entries.length,
          truncated: value.truncated,
          maxDepth: value.maxDepth
        }
      };
    }
  }).then((result) => result.value);
}

async function runGovernedReadManyFiles(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    paths: string[];
    maxBytesPerFile?: number;
    maxTotalBytes?: number;
  }
) {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: filesystemReadAction({
      cwd: options.cwd,
      actionType: "filesystem.read",
      path: ".",
      filesTouched: options.paths,
      stableParts: [
        options.cwd,
        options.paths,
        options.maxBytesPerFile,
        options.maxTotalBytes
      ]
    }),
    run: async () => {
      const value = await readManyWorkspaceFiles(options.cwd, {
        paths: options.paths,
        ...(options.maxBytesPerFile === undefined
          ? {}
          : { maxBytesPerFile: options.maxBytesPerFile }),
        ...(options.maxTotalBytes === undefined
          ? {}
          : { maxTotalBytes: options.maxTotalBytes })
      });

      return {
        value,
        output: {
          files: value.files.length,
          errors: value.errors.length,
          bytes: value.bytes,
          returnedBytes: value.returnedBytes,
          truncated: value.truncated
        }
      };
    }
  }).then((result) => result.value);
}

async function runGovernedSearchText(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    query: string;
    regex: boolean;
    glob?: string[];
    caseSensitive: boolean;
    contextLines?: number;
    maxMatches?: number;
    maxBytesPerFile?: number;
  }
) {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: filesystemReadAction({
      cwd: options.cwd,
      actionType: "filesystem.search",
      path: ".",
      stableParts: [
        options.cwd,
        options.query,
        options.regex,
        options.glob ?? [],
        options.caseSensitive,
        options.contextLines,
        options.maxMatches,
        options.maxBytesPerFile
      ]
    }),
    run: async () => {
      const value = await searchWorkspaceText(options.cwd, {
        query: options.query,
        regex: options.regex,
        ...(options.glob === undefined ? {} : { glob: options.glob }),
        caseSensitive: options.caseSensitive,
        ...(options.contextLines === undefined
          ? {}
          : { contextLines: options.contextLines }),
        ...(options.maxMatches === undefined ? {} : { maxMatches: options.maxMatches }),
        ...(options.maxBytesPerFile === undefined
          ? {}
          : { maxBytesPerFile: options.maxBytesPerFile })
      });

      return {
        value,
        output: {
          matches: value.matches.length,
          truncated: value.truncated,
          filesSearched: value.filesSearched,
          filesTruncated: value.filesTruncated,
          filesSkippedTooLarge: value.filesSkippedTooLarge
        }
      };
    }
  }).then((result) => result.value);
}

async function runGovernedListFiles(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    glob?: string[];
    exclude?: string[];
    maxResults?: number;
    includeDirs: boolean;
  }
) {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: filesystemReadAction({
      cwd: options.cwd,
      actionType: "filesystem.list",
      path: ".",
      stableParts: [
        options.cwd,
        options.glob ?? [],
        options.exclude ?? [],
        options.maxResults,
        options.includeDirs
      ]
    }),
    run: async () => {
      const value = await listWorkspaceFiles(options.cwd, {
        ...(options.glob === undefined ? {} : { glob: options.glob }),
        ...(options.exclude === undefined ? {} : { exclude: options.exclude }),
        ...(options.maxResults === undefined ? {} : { maxResults: options.maxResults }),
        includeDirs: options.includeDirs
      });

      return {
        value,
        output: {
          entries: value.entries.length,
          truncated: value.truncated,
          maxResults: value.maxResults
        }
      };
    }
  }).then((result) => result.value);
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

async function runGovernedGitCommand<T extends JsonObject>(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    actionType: "git.log" | "git.show";
    command: string;
    maxBytes?: number;
    output: (result: ShellCommandResult) => T;
  }
): Promise<T> {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: gitReadAction({
      cwd: options.cwd,
      actionType: options.actionType
    }),
    run: async () => {
      const value = await runShellCommand({
        command: options.command,
        cwd: options.cwd,
        ...(options.maxBytes === undefined ? {} : { maxOutputBytes: options.maxBytes })
      });
      const output = shellCommandOutput(value);

      return {
        value: options.output(value),
        output
      };
    }
  }).then((result) => result.value);
}

async function finalizeBudgetExceededWorkerResult(input: {
  options: CodexDirectWorkerOptions;
  workerRun: WorkerRun;
  messages: CodexResponsesInputItem[];
  reason: CodexDirectBudgetReason;
  maxTurns: number;
  toolCalls: number;
  failedToolCalls: number;
  verification?: RuntimeVerificationStatus;
  warnings?: string[];
}): Promise<CodexDirectWorkerResult> {
  const budget = codexDirectBudgetSummary(input);
  const warning = codexDirectBudgetWarning(budget);
  const warnings = [...(input.warnings ?? []), warning];

  if (input.options.finalizeOnBudget === true) {
    input.messages.push({
      role: "user",
      content: [
        `Runstead budget exhausted: ${warning}`,
        "Do not request or assume any more tool calls.",
        "Return a concise final summary from the evidence already gathered."
      ].join("\n")
    });

    try {
      const response = await runGovernedModelInference({
        ...input.options,
        workerRun: input.workerRun,
        request: {
          model: input.options.model,
          instructions: buildCodexDirectInstructions(input.options),
          input: input.messages,
          sessionId: input.options.task.id
        },
        phase: "final_summary"
      });
      const summary = response.outputText || "Codex Direct worker stopped on budget.";

      return completedWorkerResult({
        options: input.options,
        workerRun: input.workerRun,
        status: "completed",
        exitCode: 0,
        summary,
        toolCalls: input.toolCalls,
        failedToolCalls: input.failedToolCalls,
        verification: input.verification ?? "skipped",
        warnings,
        budget
      });
    } catch (error) {
      const interruption =
        error instanceof CodexDirectModelRetryExhaustedError
          ? modelRetryExhaustedInterruption(input.options, error)
          : error instanceof CodexDirectModelTimeoutError
            ? modelTimeoutInterruption(input.options, error)
            : undefined;

      return completedWorkerResult({
        options: input.options,
        workerRun: input.workerRun,
        status: "failed",
        exitCode: 1,
        summary: `${warning} Final summary request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        toolCalls: input.toolCalls,
        failedToolCalls: input.failedToolCalls,
        verification: input.verification ?? "skipped",
        warnings,
        budget,
        ...(interruption === undefined ? {} : { interruption })
      });
    }
  }

  return completedWorkerResult({
    options: input.options,
    workerRun: input.workerRun,
    status: "failed",
    exitCode: 1,
    summary: warning,
    toolCalls: input.toolCalls,
    failedToolCalls: input.failedToolCalls,
    verification: input.verification ?? "skipped",
    warnings,
    budget
  });
}

function codexDirectBudgetSummary(input: {
  options: CodexDirectWorkerOptions;
  reason: CodexDirectBudgetReason;
  maxTurns: number;
  toolCalls: number;
  failedToolCalls: number;
}): CodexDirectBudgetSummary {
  return {
    reason: input.reason,
    maxTurns: input.maxTurns,
    ...(input.options.maxToolCalls === undefined
      ? {}
      : { maxToolCalls: input.options.maxToolCalls }),
    ...(input.options.maxFailedToolCalls === undefined
      ? {}
      : { maxFailedToolCalls: input.options.maxFailedToolCalls }),
    toolCalls: input.toolCalls,
    failedToolCalls: input.failedToolCalls
  };
}

function codexDirectBudgetWarning(budget: CodexDirectBudgetSummary): string {
  switch (budget.reason) {
    case "turns":
      return `Codex Direct worker turn budget exhausted after ${budget.maxTurns} turns and ${budget.toolCalls} tool calls.`;
    case "tool_calls":
      return `Codex Direct worker tool budget exhausted after ${budget.toolCalls} tool calls.`;
    case "failed_tool_calls":
      return `Codex Direct worker failed-tool budget exhausted after ${budget.failedToolCalls} failed tool calls.`;
  }
}

function completedWorkerResult(input: {
  options: Pick<
    CodexDirectWorkerOptions,
    "database" | "model" | "modelProviderResourceId" | "now"
  >;
  workerRun: WorkerRun;
  status: CodexDirectWorkerResult["status"];
  exitCode: number;
  summary: string;
  toolCalls: number;
  failedToolCalls: number;
  verification?: RuntimeVerificationStatus;
  warnings?: string[];
  interruption?: CodexDirectWorkerResult["interruption"];
  budget?: CodexDirectBudgetSummary;
  approval?: CodexDirectWorkerResult["approval"];
}): CodexDirectWorkerResult {
  const warnings = input.warnings ?? [];
  const modelProvider = input.options.modelProviderResourceId ?? "chatgpt_codex";
  const execution = codexDirectExecutionSemantics({
    status: input.status,
    toolCalls: input.toolCalls,
    ...(input.budget === undefined ? {} : { budget: input.budget }),
    verification: input.verification ?? "skipped"
  });
  const output = {
    worker: CODEX_DIRECT_WORKER_KIND,
    model: input.options.model,
    modelProvider,
    summary: input.summary,
    execution,
    toolCalls: input.toolCalls,
    failedToolCalls: input.failedToolCalls,
    ...(input.interruption === undefined ? {} : { interruption: input.interruption }),
    ...(warnings.length === 0 ? {} : { warnings }),
    ...(input.budget === undefined ? {} : { budget: input.budget }),
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
    modelProvider,
    status: input.status,
    exitCode: input.exitCode,
    summary: input.summary,
    execution,
    toolCalls: input.toolCalls,
    failedToolCalls: input.failedToolCalls,
    warnings,
    ...(input.interruption === undefined ? {} : { interruption: input.interruption }),
    workerRun,
    ...(input.budget === undefined ? {} : { budget: input.budget }),
    ...(input.approval === undefined ? {} : { approval: input.approval })
  };
}

function codexDirectExecutionSemantics(input: {
  status: CodexDirectWorkerResult["status"];
  toolCalls: number;
  budget?: CodexDirectBudgetSummary;
  verification: RuntimeVerificationStatus;
}): RuntimeExecutionSemantics {
  const worker: RuntimeWorkerOutcome = {
    kind: "governed",
    status: input.status,
    toolCalls: input.toolCalls,
    ...(input.budget === undefined ? {} : { budgetExhausted: true })
  };
  const verifier =
    input.verification === "skipped" ? undefined : { status: input.verification };

  return verifier === undefined
    ? runtimeExecutionSemantics({ worker })
    : runtimeExecutionSemantics({ worker, verifier });
}

function codexDirectVerificationStatus(
  task: Task,
  verifierResults: Map<string, RuntimeVerificationStatus>
): RuntimeVerificationStatus {
  const declaredNames = declaredVerifierCommands(task).map((command) => command.name);

  if (declaredNames.length === 0 || verifierResults.size === 0) {
    return "skipped";
  }

  if (declaredNames.some((name) => verifierResults.get(name) === "failed")) {
    return "failed";
  }

  return declaredNames.every((name) => verifierResults.get(name) === "passed")
    ? "passed"
    : "skipped";
}

function recordCodexDirectVerifierResult(input: {
  toolCall: CodexDirectToolCall;
  toolResult: { output: string; failed: boolean };
  verifierResults: Map<string, RuntimeVerificationStatus>;
}): void {
  if (input.toolCall.name !== "run_verifier" || input.toolResult.failed) {
    return;
  }

  const parsed = safeJsonObject(input.toolResult.output);
  if (parsed === undefined) {
    return;
  }

  const verifier = typeof parsed.verifier === "string" ? parsed.verifier : undefined;

  if (verifier === undefined) {
    return;
  }

  input.verifierResults.set(
    verifier,
    parsed.exitCode === 0 && parsed.timedOut === false ? "passed" : "failed"
  );
}

function safeJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;

    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function codexDirectWarningOptions(
  warnings: string[] | undefined
): { warnings: string[] } | object {
  return warnings === undefined ? {} : { warnings };
}

function workerRunStatus(
  status: CodexDirectWorkerResult["status"]
): Exclude<WorkerRun["status"], "running"> {
  switch (status) {
    case "completed":
      return "completed";
    case "waiting_approval":
      return "waiting_approval";
    case "interrupted":
      return "interrupted";
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
  options: Pick<
    CodexDirectWorkerOptions,
    "cwd" | "stateDb" | "database" | "policy" | "task" | "now"
  > & { workerRun: WorkerRun }
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
  actionType: "git.status" | "git.diff" | "git.log" | "git.show" | "git.diff.summary";
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

function filesystemReadAction(input: {
  cwd: string;
  actionType:
    | "filesystem.list"
    | "filesystem.search"
    | "filesystem.read"
    | "filesystem.stat";
  path: string;
  filesTouched?: string[];
  stableParts: unknown[];
}): ActionEnvelope {
  return {
    actionId: stableActionId(input.actionType, input.stableParts),
    actionType: input.actionType,
    resource: {
      type: "directory",
      path: input.path
    },
    context: {
      cwd: input.cwd,
      ...(input.filesTouched === undefined ? {} : { filesTouched: input.filesTouched })
    }
  };
}

function repositoryMetadataReadAction(input: {
  cwd: string;
  path: string;
}): ActionEnvelope {
  return {
    actionId: stableActionId("repo.metadata.read", [input.cwd, input.path]),
    actionType: "repo.metadata.read",
    resource: {
      type: "package_manifest",
      path: input.path
    },
    context: {
      cwd: input.cwd,
      filesTouched: [
        input.path === "." ? "package.json" : `${input.path}/package.json`,
        input.path === "."
          ? "pnpm-workspace.yaml"
          : `${input.path}/pnpm-workspace.yaml`,
        input.path === "." ? "turbo.json" : `${input.path}/turbo.json`
      ]
    }
  };
}

function filesystemPatchAction(input: {
  cwd: string;
  filesTouched: string[];
  approvalMetadata: CodexDirectPatchApprovalMetadata;
  pendingPatch: CodexDirectPendingPatchPayload;
  stableParts: unknown[];
}): ActionEnvelope {
  return {
    actionId: stableActionId("filesystem.patch", input.stableParts),
    actionType: "filesystem.patch",
    resource: {
      type: "file",
      path: input.filesTouched[0] ?? "."
    },
    context: {
      cwd: input.cwd,
      filesTouched: input.filesTouched,
      diffHash: input.approvalMetadata.diffHash,
      riskClass: input.approvalMetadata.riskClass,
      dependencyImpact: input.approvalMetadata.dependencyImpact,
      riskSummary: input.approvalMetadata.riskSummary,
      canonicalSignature: input.approvalMetadata.canonicalSignature,
      ...(input.approvalMetadata.approvalGrant === undefined
        ? {}
        : { approvalGrant: input.approvalMetadata.approvalGrant }),
      pendingPatch: input.pendingPatch,
      sideEffects: ["write_workspace"]
    }
  };
}

function verifierRunAction(input: {
  task: Task;
  cwd: string;
  command: CommandVerifierInput;
}): ActionEnvelope {
  return {
    actionId: stableActionId("verifier.run", [
      input.task.id,
      input.command.name,
      input.command.command
    ]),
    actionType: "verifier.run",
    resource: {
      type: "verifier",
      id: input.command.name
    },
    context: {
      cwd: input.cwd,
      command: input.command.command,
      sideEffects: ["execute_process", "read_workspace"]
    }
  };
}

function evidenceReadAction(input: {
  cwd: string;
  evidenceId: string;
}): ActionEnvelope {
  return {
    actionId: stableActionId("evidence.read", [input.cwd, input.evidenceId]),
    actionType: "evidence.read",
    resource: {
      type: "evidence",
      id: input.evidenceId
    },
    context: {
      cwd: input.cwd
    }
  };
}

function workspaceFactsReadAction(input: {
  cwd: string;
  refresh: boolean;
}): ActionEnvelope {
  return {
    actionId: stableActionId("workspace.facts.read", [input.cwd, input.refresh]),
    actionType: "workspace.facts.read",
    resource: {
      type: "repository",
      id: input.cwd
    },
    context: {
      cwd: input.cwd
    }
  };
}

function modelInferenceAction(input: {
  task: Task;
  model: string;
  providerResourceId?: string;
  networkDomains?: string[];
}): ActionEnvelope {
  const providerResourceId = input.providerResourceId ?? "chatgpt_codex";

  return {
    actionId: stableActionId("model_inference_request", [
      input.task.id,
      providerResourceId,
      input.model
    ]),
    actionType: "model.inference.request",
    resource: {
      type: "model_provider",
      id: providerResourceId
    },
    context: {
      networkDomains: input.networkDomains ?? ["chatgpt.com"],
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

function optionalField<K extends string, V>(
  key: K,
  value: V | undefined
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string" && value.length > 0) {
    return [value];
  }

  if (Array.isArray(value)) {
    const strings: string[] = [];

    for (const item of value) {
      if (typeof item !== "string" || item.length === 0) {
        throw new Error(
          `Codex Direct tool argument ${field} must be a string or an array of non-empty strings`
        );
      }

      strings.push(item);
    }

    return strings;
  }

  throw new Error(
    `Codex Direct tool argument ${field} must be a string or an array of non-empty strings`
  );
}

function requiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `Codex Direct tool argument ${field} must be a non-empty array of non-empty strings`
    );
  }

  const strings = optionalStringArray(value, field);

  if (strings === undefined || strings.length === 0) {
    throw new Error(
      `Codex Direct tool argument ${field} must be a non-empty array of non-empty strings`
    );
  }

  return strings;
}

function optionalReplacementArray(value: unknown):
  | {
      path: string;
      search: string;
      replace: string;
      replaceAll?: boolean;
    }[]
  | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error("Codex Direct tool argument replacements must be an array");
  }

  return value.map((item) => {
    if (!isRecord(item)) {
      throw new Error("Codex Direct replacement entries must be objects");
    }

    return {
      path: requiredString(item.path, "path"),
      search: requiredString(item.search, "search"),
      replace:
        typeof item.replace === "string"
          ? item.replace
          : requiredString(item.replace, "replace"),
      ...(item.replaceAll === undefined ? {} : { replaceAll: item.replaceAll === true })
    };
  });
}

function codexDirectPatchFilesTouched(input: {
  patch?: string;
  replacements?: {
    path: string;
    search: string;
    replace: string;
    replaceAll?: boolean;
  }[];
}): string[] {
  return inferWorkspacePatchTouchedFiles(input);
}

interface CodexDirectTaskScaffoldProfile {
  id: string;
  appOwnedPaths: string[];
}

const SCAFFOLD_APP_PATCH_PROTECTED_PATH_PATTERNS = [
  ".env",
  ".env.*",
  "**/secrets/**",
  ".git/**",
  ".runstead/**",
  "infra/prod/**",
  "node_modules/**",
  "dist/**",
  "build/**"
];

function codexDirectTaskScaffoldProfile(
  task: Task
): CodexDirectTaskScaffoldProfile | undefined {
  const profile = task.input.scaffoldProfile;

  if (!isRecord(profile) || typeof profile.id !== "string") {
    return undefined;
  }

  const appOwnedPaths = stringArray(profile.appOwnedPaths);

  if (appOwnedPaths === undefined || appOwnedPaths.length === 0) {
    return undefined;
  }

  return {
    id: profile.id,
    appOwnedPaths
  };
}

function isScaffoldAppOwnedPatchPath(path: string, appOwnedPaths: string[]): boolean {
  if (
    SCAFFOLD_APP_PATCH_PROTECTED_PATH_PATTERNS.some((pattern) =>
      matchesPolicyPathPattern(path, pattern)
    )
  ) {
    return false;
  }

  return appOwnedPaths.some((pattern) => matchesPolicyPathPattern(path, pattern));
}

interface CodexDirectPatchApprovalMetadata {
  diffHash: string;
  riskClass: "workspace_patch" | "dependency_patch" | "scaffold_app_patch";
  dependencyImpact: {
    kind: "none" | "dependency_files_touched";
    files: string[];
  };
  riskSummary: string;
  canonicalSignature: string;
  approvalGrant?: {
    mode: "scoped_until_expiry";
    scope: string;
  };
}

interface CodexDirectPendingPatchPayload extends CodexDirectPatchApprovalMetadata {
  mode: "unified_diff" | "replacements";
  filesTouched: string[];
  resumeContext?: CodexDirectPendingToolResumeContext;
  patch?: string;
  replacements?: {
    path: string;
    search: string;
    replace: string;
    replaceAll?: boolean;
  }[];
}

interface CodexDirectPendingToolResumeContext {
  messages: CodexResponsesInputItem[];
  toolCall: CodexResponsesFunctionCallInputItem;
}

type ActionEnvelopeWithPendingPatch = ActionEnvelope & {
  context: NonNullable<ActionEnvelope["context"]> & {
    pendingPatch: CodexDirectPendingPatchPayload;
  };
};

function codexDirectPatchApprovalMetadata(input: {
  cwd: string;
  task: Task;
  filesTouched: string[];
  patch?: string;
  replacements?: {
    path: string;
    search: string;
    replace: string;
    replaceAll?: boolean;
  }[];
}): CodexDirectPatchApprovalMetadata {
  const sortedFiles = [...input.filesTouched].sort((left, right) =>
    left.localeCompare(right)
  );
  const diffHash = sha256({
    patch: input.patch ?? null,
    replacements: input.replacements ?? null
  });
  const dependencyFiles = sortedFiles.filter(isDependencyFilePath);
  const dependencyImpact = {
    kind:
      dependencyFiles.length === 0
        ? ("none" as const)
        : ("dependency_files_touched" as const),
    files: dependencyFiles
  };
  const scaffoldProfile = codexDirectTaskScaffoldProfile(input.task);
  const scaffoldAppPatch =
    dependencyFiles.length === 0 &&
    scaffoldProfile !== undefined &&
    sortedFiles.length > 0 &&
    sortedFiles.every((file) =>
      isScaffoldAppOwnedPatchPath(file, scaffoldProfile.appOwnedPaths)
    );
  const riskClass =
    dependencyFiles.length > 0
      ? ("dependency_patch" as const)
      : scaffoldAppPatch
        ? ("scaffold_app_patch" as const)
        : ("workspace_patch" as const);
  const riskSummary =
    dependencyFiles.length > 0
      ? `Patch touches dependency files: ${dependencyFiles.join(", ")}.`
      : scaffoldAppPatch
        ? `Patch touches ${sortedFiles.length} app-owned scaffold file${sortedFiles.length === 1 ? "" : "s"} for ${scaffoldProfile.id}.`
        : `Patch touches ${sortedFiles.length} workspace file${sortedFiles.length === 1 ? "" : "s"} with no dependency file impact.`;
  const canonicalSignature = sha256({
    actionType: "filesystem.patch",
    cwd: input.cwd,
    filesTouched: sortedFiles,
    diffHash,
    riskClass
  });
  const approvalGrant =
    scaffoldAppPatch && scaffoldProfile !== undefined
      ? {
          mode: "scoped_until_expiry" as const,
          scope: `task:${input.task.id}:scaffold:${scaffoldProfile.id}:app_owned_patch`
        }
      : undefined;

  return {
    diffHash,
    riskClass,
    dependencyImpact,
    riskSummary,
    canonicalSignature,
    ...(approvalGrant === undefined ? {} : { approvalGrant })
  };
}

function codexDirectPendingPatchPayload(input: {
  filesTouched: string[];
  approvalMetadata: CodexDirectPatchApprovalMetadata;
  resumeContext?: CodexDirectPendingToolResumeContext;
  patch?: string;
  replacements?: {
    path: string;
    search: string;
    replace: string;
    replaceAll?: boolean;
  }[];
}): CodexDirectPendingPatchPayload {
  return {
    mode: input.patch === undefined ? "replacements" : "unified_diff",
    filesTouched: input.filesTouched,
    diffHash: input.approvalMetadata.diffHash,
    riskClass: input.approvalMetadata.riskClass,
    dependencyImpact: input.approvalMetadata.dependencyImpact,
    riskSummary: input.approvalMetadata.riskSummary,
    canonicalSignature: input.approvalMetadata.canonicalSignature,
    ...(input.resumeContext === undefined
      ? {}
      : {
          resumeContext: {
            messages: cloneCodexResponsesMessages(input.resumeContext.messages),
            toolCall: input.resumeContext.toolCall
          }
        }),
    ...(input.patch === undefined ? {} : { patch: input.patch }),
    ...(input.replacements === undefined ? {} : { replacements: input.replacements })
  };
}

function parsePendingPatchAction(
  actionJson: string
): ActionEnvelopeWithPendingPatch | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(actionJson) as unknown;
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || parsed.actionType !== "filesystem.patch") {
    return undefined;
  }

  const context = isRecord(parsed.context) ? parsed.context : undefined;
  const pendingPatch = parseCodexDirectPendingPatchPayload(context?.pendingPatch);

  if (
    typeof parsed.actionId !== "string" ||
    typeof parsed.actionType !== "string" ||
    pendingPatch === undefined
  ) {
    return undefined;
  }

  let resource: ActionEnvelope["resource"];

  if (isRecord(parsed.resource)) {
    if (typeof parsed.resource.type !== "string") {
      return undefined;
    }

    resource = {
      type: parsed.resource.type,
      ...(typeof parsed.resource.id === "string" ? { id: parsed.resource.id } : {}),
      ...(typeof parsed.resource.path === "string"
        ? { path: parsed.resource.path }
        : {})
    };
  }

  return {
    actionId: parsed.actionId,
    actionType: parsed.actionType,
    ...(resource === undefined ? {} : { resource }),
    context: {
      ...(context ?? {}),
      pendingPatch
    }
  };
}

function parseCodexDirectPendingPatchPayload(
  value: unknown
): CodexDirectPendingPatchPayload | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const mode = value.mode;
  const dependencyImpact = isRecord(value.dependencyImpact)
    ? value.dependencyImpact
    : undefined;
  const filesTouched = stringArray(value.filesTouched);
  const dependencyFiles = stringArray(dependencyImpact?.files);

  if (
    (mode !== "unified_diff" && mode !== "replacements") ||
    filesTouched === undefined ||
    dependencyImpact === undefined ||
    dependencyFiles === undefined ||
    typeof dependencyImpact.kind !== "string" ||
    typeof value.diffHash !== "string" ||
    typeof value.riskClass !== "string" ||
    typeof value.riskSummary !== "string" ||
    typeof value.canonicalSignature !== "string"
  ) {
    return undefined;
  }

  if (mode === "unified_diff") {
    return typeof value.patch === "string"
      ? {
          mode,
          filesTouched,
          diffHash: value.diffHash,
          riskClass: normalizePendingPatchRiskClass(value.riskClass),
          dependencyImpact: {
            kind:
              dependencyImpact.kind === "dependency_files_touched"
                ? "dependency_files_touched"
                : "none",
            files: dependencyFiles
          },
          riskSummary: value.riskSummary,
          canonicalSignature: value.canonicalSignature,
          ...optionalParsedResumeContext(value.resumeContext),
          patch: value.patch
        }
      : undefined;
  }

  const replacements = replacementArray(value.replacements);

  return replacements === undefined
    ? undefined
    : {
        mode,
        filesTouched,
        diffHash: value.diffHash,
        riskClass: normalizePendingPatchRiskClass(value.riskClass),
        dependencyImpact: {
          kind:
            dependencyImpact.kind === "dependency_files_touched"
              ? "dependency_files_touched"
              : "none",
          files: dependencyFiles
        },
        riskSummary: value.riskSummary,
        canonicalSignature: value.canonicalSignature,
        ...optionalParsedResumeContext(value.resumeContext),
        replacements
      };
}

function optionalParsedResumeContext(
  value: unknown
): { resumeContext: CodexDirectPendingToolResumeContext } | object {
  const resumeContext = parseCodexDirectPendingToolResumeContext(value);

  return resumeContext === undefined ? {} : { resumeContext };
}

function parseCodexDirectPendingToolResumeContext(
  value: unknown
): CodexDirectPendingToolResumeContext | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const messages = parseCodexResponsesInputItems(value.messages);
  const toolCall = parseCodexResponsesFunctionCallInputItem(value.toolCall);

  return messages === undefined || toolCall === undefined
    ? undefined
    : { messages, toolCall };
}

function cloneCodexResponsesMessages(
  messages: CodexResponsesInputItem[]
): CodexResponsesInputItem[] {
  return messages.map((item) => ({ ...item }));
}

function parseCodexResponsesInputItems(
  value: unknown
): CodexResponsesInputItem[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parsed = value.map(parseCodexResponsesInputItem);

  return parsed.every((item): item is CodexResponsesInputItem => item !== undefined)
    ? parsed
    : undefined;
}

function parseCodexResponsesInputItem(
  value: unknown
): CodexResponsesInputItem | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string"
  ) {
    return {
      role: value.role,
      content: value.content
    };
  }

  if (value.type === "function_call") {
    return parseCodexResponsesFunctionCallInputItem(value);
  }

  if (
    value.type === "function_call_output" &&
    typeof value.call_id === "string" &&
    typeof value.output === "string"
  ) {
    return {
      type: "function_call_output",
      call_id: value.call_id,
      output: value.output
    };
  }

  return undefined;
}

function parseCodexResponsesFunctionCallInputItem(
  value: unknown
): CodexResponsesFunctionCallInputItem | undefined {
  if (
    !isRecord(value) ||
    value.type !== "function_call" ||
    typeof value.call_id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.arguments !== "string"
  ) {
    return undefined;
  }

  return {
    type: "function_call",
    call_id: value.call_id,
    name: value.name,
    arguments: value.arguments
  };
}

function normalizePendingPatchRiskClass(
  value: string
): CodexDirectPatchApprovalMetadata["riskClass"] {
  if (value === "dependency_patch" || value === "scaffold_app_patch") {
    return value;
  }

  return "workspace_patch";
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0
  );

  return strings.length === value.length ? strings : undefined;
}

function replacementArray(
  value: unknown
): CodexDirectPendingPatchPayload["replacements"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const replacements: NonNullable<CodexDirectPendingPatchPayload["replacements"]> = [];

  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.path !== "string" ||
      typeof item.search !== "string" ||
      typeof item.replace !== "string"
    ) {
      return undefined;
    }

    replacements.push({
      path: item.path,
      search: item.search,
      replace: item.replace,
      ...(item.replaceAll === undefined ? {} : { replaceAll: item.replaceAll === true })
    });
  }

  return replacements;
}

function isDependencyFilePath(path: string): boolean {
  const fileName = path.split("/").pop() ?? path;

  return DEPENDENCY_FILE_NAMES.has(fileName);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function resolveVerifierCommand(
  options: Pick<CodexDirectWorkerOptions, "cwd" | "task"> & { name: string }
): Promise<CommandVerifierInput> {
  const declared = declaredVerifierCommands(options.task);
  const discovered = await discoverVerifierCommands({ cwd: options.cwd });
  const candidates = [...declared, ...discovered];
  const command = candidates.find((candidate) => candidate.name === options.name);

  if (command === undefined) {
    throw new Error(
      `Verifier not available: ${options.name}. Available verifiers: ${
        candidates.map((candidate) => candidate.name).join(", ") || "none"
      }`
    );
  }

  return command;
}

async function readEvidenceArtifact(input: {
  database: RunsteadDatabase;
  evidenceId: string;
  maxBytes: number;
}): Promise<{
  evidence: {
    id: string;
    type: string;
    subjectType: string;
    subjectId: string;
    uri: string;
    hash?: string;
    summary?: string;
    createdAt: string;
  };
  artifact?: {
    path: string;
    content: string;
    bytes: number;
    returnedBytes: number;
    truncated: boolean;
  };
}> {
  const row = input.database
    .prepare(
      `
      SELECT id, type, subject_type, subject_id, uri, hash, summary, created_at
      FROM evidence
      WHERE id = ?
    `
    )
    .get(input.evidenceId) as
    | {
        id: string;
        type: string;
        subject_type: string;
        subject_id: string;
        uri: string;
        hash: string | null;
        summary: string | null;
        created_at: string;
      }
    | undefined;

  if (row === undefined) {
    throw new Error(`Evidence not found: ${input.evidenceId}`);
  }

  const evidence = {
    id: row.id,
    type: row.type,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    uri: row.uri,
    ...(row.hash === null ? {} : { hash: row.hash }),
    ...(row.summary === null ? {} : { summary: row.summary }),
    createdAt: row.created_at
  };
  const artifactPath = filePathFromEvidenceUri(row.uri);

  if (artifactPath === undefined) {
    return {
      evidence
    };
  }

  const content = await readFile(artifactPath, "utf8");
  const bytes = Buffer.byteLength(content, "utf8");
  const truncated = bytes > input.maxBytes;
  const returnedContent = truncated ? content.slice(0, input.maxBytes) : content;

  return {
    evidence,
    artifact: {
      path: artifactPath,
      content: returnedContent,
      bytes,
      returnedBytes: Buffer.byteLength(returnedContent, "utf8"),
      truncated
    }
  };
}

async function readWorkspaceFacts(input: {
  cwd: string;
  evidenceDir: string;
  database: RunsteadDatabase;
  refresh: boolean;
  now?: Date;
}): Promise<{
  cached: boolean;
  evidence: {
    id: string;
    type: string;
    subjectType: string;
    subjectId: string;
    uri: string;
    hash?: string;
    summary?: string;
    createdAt: string;
  };
  facts: RepoInspectionSnapshot;
}> {
  if (!input.refresh) {
    const cached = await readLatestWorkspaceFacts(input.database);

    if (cached !== undefined) {
      return {
        cached: true,
        evidence: cached.evidence,
        facts: cached.facts
      };
    }
  }

  const stored = await storeRepoInspectionEvidence({
    cwd: input.cwd,
    runsteadRoot: dirname(input.evidenceDir),
    database: input.database,
    ...(input.now === undefined ? {} : { now: input.now })
  });

  return {
    cached: false,
    evidence: {
      id: stored.evidence.id,
      type: stored.evidence.type,
      subjectType: stored.evidence.subjectType,
      subjectId: stored.evidence.subjectId,
      uri: stored.evidence.uri,
      ...(stored.evidence.hash === undefined ? {} : { hash: stored.evidence.hash }),
      ...(stored.evidence.summary === undefined
        ? {}
        : { summary: stored.evidence.summary }),
      createdAt: stored.evidence.createdAt
    },
    facts: stored.snapshot
  };
}

async function readLatestWorkspaceFacts(database: RunsteadDatabase): Promise<
  | {
      evidence: {
        id: string;
        type: string;
        subjectType: string;
        subjectId: string;
        uri: string;
        hash?: string;
        summary?: string;
        createdAt: string;
      };
      facts: RepoInspectionSnapshot;
    }
  | undefined
> {
  const row = database
    .prepare(
      `
      SELECT id, type, subject_type, subject_id, uri, hash, summary, created_at
      FROM evidence
      WHERE type = 'repo_inspection'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `
    )
    .get() as
    | {
        id: string;
        type: string;
        subject_type: string;
        subject_id: string;
        uri: string;
        hash: string | null;
        summary: string | null;
        created_at: string;
      }
    | undefined;

  if (row === undefined) {
    return undefined;
  }

  const artifactPath = filePathFromEvidenceUri(row.uri);

  if (artifactPath === undefined) {
    return undefined;
  }

  const facts = JSON.parse(
    await readFile(artifactPath, "utf8")
  ) as RepoInspectionSnapshot;

  return {
    evidence: {
      id: row.id,
      type: row.type,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      uri: row.uri,
      ...(row.hash === null ? {} : { hash: row.hash }),
      ...(row.summary === null ? {} : { summary: row.summary }),
      createdAt: row.created_at
    },
    facts
  };
}

function filePathFromEvidenceUri(uri: string): string | undefined {
  try {
    const url = new URL(uri);

    return url.protocol === "file:" ? fileURLToPath(url) : undefined;
  } catch {
    return undefined;
  }
}

function declaredVerifierCommands(task: Task): CommandVerifierInput[] {
  const commands = task.input.commands;

  if (!Array.isArray(commands)) {
    return [];
  }

  return commands.flatMap((command) => {
    if (!isRecord(command)) {
      return [];
    }

    const name = command.name;
    const commandText = command.command;

    return typeof name === "string" && typeof commandText === "string"
      ? [{ name, command: commandText }]
      : [];
  });
}

function previewText(value: string): string {
  return value.length <= 500 ? value : `${value.slice(0, 500)}...`;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  return undefined;
}

function optionalNonNegativeInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  throw new Error(`Codex Direct tool argument ${field} must be a non-negative integer`);
}

function optionalTimeoutMs(value: unknown): { timeoutMs?: number } {
  const timeoutMs = optionalPositiveInteger(value);

  return timeoutMs === undefined ? {} : { timeoutMs };
}

function taskGitDiffStaged(task: Task): boolean | undefined {
  const value = task.input.gitDiffStaged;

  return typeof value === "boolean" ? value : undefined;
}

function taskGitDiffBase(task: Task): string | undefined {
  const value = task.input.gitDiffBase;

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function gitDiffCommand(input: {
  path: string | undefined;
  staged: boolean;
  base: string | undefined;
}): string {
  const base = input.staged
    ? "git diff --staged"
    : input.base === undefined
      ? "git diff"
      : `git diff --end-of-options ${shellQuote(
          `${safeGitRevision(input.base, "base")}...HEAD`
        )}`;

  return input.path === undefined ? base : `${base} -- ${shellQuote(input.path)}`;
}

function gitDiffSummaryCommand(
  mode: "--numstat" | "--name-status" | "--shortstat",
  input: {
    path: string | undefined;
    staged: boolean;
    base: string | undefined;
  }
): string {
  const base = input.staged
    ? `git diff --staged ${mode}`
    : input.base === undefined
      ? `git diff ${mode}`
      : `git diff ${mode} --end-of-options ${shellQuote(
          `${safeGitRevision(input.base, "base")}...HEAD`
        )}`;

  return input.path === undefined ? base : `${base} -- ${shellQuote(input.path)}`;
}

function mergeDiffSummaryRows(input: { numstat: string; nameStatus: string }): {
  path: string;
  status?: string;
  additions: number | "binary";
  deletions: number | "binary";
}[] {
  const statuses = new Map<string, string>();

  for (const line of input.nameStatus.split(/\r?\n/)) {
    if (line.length === 0) {
      continue;
    }

    const [status, ...paths] = line.split("\t");
    const path = paths.at(-1);

    if (status !== undefined && path !== undefined) {
      statuses.set(path, status);
    }
  }

  return input.numstat
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      const [added = "0", deleted = "0", path = ""] = line.split("\t");
      const additions = added === "-" ? "binary" : Number.parseInt(added, 10);
      const deletions = deleted === "-" ? "binary" : Number.parseInt(deleted, 10);
      const status = statuses.get(path);

      return {
        path,
        ...(status === undefined ? {} : { status }),
        additions:
          additions === "binary" ? "binary" : Number.isNaN(additions) ? 0 : additions,
        deletions:
          deletions === "binary" ? "binary" : Number.isNaN(deletions) ? 0 : deletions
      };
    });
}

function diffSummaryTotals(
  files: {
    additions: number | "binary";
    deletions: number | "binary";
  }[]
): { files: number; additions: number; deletions: number; binaryFiles: number } {
  const totals = {
    files: 0,
    additions: 0,
    deletions: 0,
    binaryFiles: 0
  };

  for (const file of files) {
    totals.files += 1;

    if (file.additions === "binary" || file.deletions === "binary") {
      totals.binaryFiles += 1;
    }

    if (file.additions !== "binary") {
      totals.additions += file.additions;
    }

    if (file.deletions !== "binary") {
      totals.deletions += file.deletions;
    }
  }

  return totals;
}

function firstNonZeroExitCode(results: ShellCommandResult[]): number {
  return results.find((result) => result.exitCode !== 0)?.exitCode ?? 0;
}

function gitLogCommand(input: {
  range: string | undefined;
  path: string | undefined;
  maxCommits: number;
}): string {
  const parts = [
    "git log",
    `--max-count=${input.maxCommits}`,
    "--date=iso-strict",
    "--pretty=format:%H%x1f%an%x1f%ae%x1f%aI%x1f%s"
  ];

  if (input.range !== undefined) {
    parts.push("--end-of-options", shellQuote(safeGitRevision(input.range, "range")));
  }

  if (input.path !== undefined) {
    parts.push("--", shellQuote(input.path));
  }

  return parts.join(" ");
}

function gitShowCommand(input: { ref: string; path: string | undefined }): string {
  const parts = [
    "git show",
    "--stat",
    "--patch",
    "--find-renames",
    "--format=fuller",
    "--end-of-options",
    shellQuote(safeGitRevision(input.ref, "ref"))
  ];

  if (input.path !== undefined) {
    parts.push("--", shellQuote(input.path));
  }

  return parts.join(" ");
}

function parseGitLogOutput(stdout: string): {
  sha: string;
  authorName: string;
  authorEmail: string;
  date: string;
  subject: string;
}[] {
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha = "", authorName = "", authorEmail = "", date = "", subject = ""] =
        line.split("\u001f");

      return {
        sha,
        authorName,
        authorEmail,
        date,
        subject
      };
    });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function safeGitRevision(value: string, field: "base" | "range" | "ref"): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`Git revision argument ${field} must not be empty`);
  }

  if (trimmed.startsWith("-")) {
    throw new Error(`Git revision argument ${field} must not start with '-'`);
  }

  return trimmed;
}

function isCodexDirectToolName(value: string): value is CodexDirectToolName {
  return [
    "list_files",
    "search_text",
    "read_file",
    "read_many_files",
    "file_info",
    "tree",
    "package_scripts",
    "apply_patch",
    "run_verifier",
    "write_file",
    "run_command",
    "git_status",
    "git_diff",
    "git_log",
    "git_show",
    "diff_summary",
    "read_evidence",
    "workspace_facts"
  ].includes(value);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
