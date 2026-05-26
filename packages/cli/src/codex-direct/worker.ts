import { type Goal, type Task, type WorkerRun } from "@runstead/core";
import { type RuntimeExecutionSemantics } from "@runstead/runtime";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import {
  type CodexResponsesInputItem,
  type CodexResponsesRequest,
  type CodexResponsesResult,
  CodexResponsesTransport
} from "../codex-responses-transport.js";
import { applyWorkspacePatch } from "../codex-direct-native-tools.js";
import {
  runGovernedToolAction,
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "../governed-action.js";
import { type ActionEnvelope, type PolicyProfile } from "../policy.js";
import { startWorkerRun } from "../runtime-audit.js";

import { runCodexDirectConversation } from "./conversation.js";
import {
  CODEX_DIRECT_WORKER_KIND,
  DEFAULT_CODEX_DIRECT_MAX_TURNS
} from "./constants.js";
import {
  buildCodexDirectUserPrompt,
  completedWorkerResult,
  CodexDirectModelTimeoutError,
  governedToolOptions,
  modelTimeoutInterruption,
  parsePendingPatchAction
} from "./tool-router.js";
import type { CodexDirectPendingPatchPayload } from "./tool-router.js";

export {
  CODEX_DIRECT_WORKER_KIND,
  DEFAULT_CODEX_DIRECT_FINAL_SUMMARY_REQUEST_TIMEOUT_MS,
  DEFAULT_CODEX_DIRECT_MAX_TURNS,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_HEARTBEAT_MS,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_MAX_RETRIES,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_BASE_DELAY_MS,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_JITTER_MS,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_MAX_DELAY_MS,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_TIMEOUT_MS
} from "./constants.js";
export {
  buildCodexDirectInstructions,
  codexDirectToolDefinitions
} from "./tool-router.js";

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
