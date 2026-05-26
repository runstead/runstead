import type { Goal, Task, WorkerRun } from "@runstead/core";
import type { RuntimeExecutionSemantics } from "@runstead/runtime";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type {
  CodexResponsesRequest,
  CodexResponsesResult
} from "../codex-responses-transport.js";
import type { ActionEnvelope, PolicyProfile } from "../policy.js";

import type { CODEX_DIRECT_WORKER_KIND } from "./constants.js";
import type { CodexDirectPendingPatchPayload } from "./patch-payload.js";

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
