import type { JsonObject } from "@runstead/core";

import type {
  CodexDirectBudgetSummary,
  CodexDirectInterruptionSummary
} from "./codex-direct-worker.js";

export function approvalFromOutput(
  output: JsonObject
): { id: string; reason: string } | undefined {
  const approval = output.approval;

  return isRecord(approval) && typeof approval.id === "string"
    ? {
        id: approval.id,
        reason:
          typeof approval.reason === "string" ? approval.reason : "approval needed"
      }
    : undefined;
}

export function interruptionFromOutput(
  value: unknown
): CodexDirectInterruptionSummary | undefined {
  if (!isRecord(value) || value.reason !== "model_timeout") {
    return undefined;
  }

  return typeof value.timeoutMs === "number" &&
    typeof value.elapsedMs === "number" &&
    typeof value.heartbeatCount === "number" &&
    typeof value.retryCommand === "string"
    ? {
        reason: "model_timeout",
        timeoutMs: value.timeoutMs,
        elapsedMs: value.elapsedMs,
        heartbeatCount: value.heartbeatCount,
        retryCommand: value.retryCommand
      }
    : undefined;
}

export function budgetFromOutput(value: unknown): CodexDirectBudgetSummary | undefined {
  return isRecord(value) &&
    isBudgetReason(value.reason) &&
    typeof value.maxTurns === "number" &&
    typeof value.toolCalls === "number" &&
    typeof value.failedToolCalls === "number"
    ? {
        reason: value.reason,
        maxTurns: value.maxTurns,
        ...(typeof value.maxToolCalls === "number"
          ? { maxToolCalls: value.maxToolCalls }
          : {}),
        ...(typeof value.maxFailedToolCalls === "number"
          ? { maxFailedToolCalls: value.maxFailedToolCalls }
          : {}),
        toolCalls: value.toolCalls,
        failedToolCalls: value.failedToolCalls
      }
    : undefined;
}

export function stringOutput(output: JsonObject, key: string): string {
  const value = output[key];

  return typeof value === "string" ? value : "";
}

export function numberOutput(output: JsonObject, key: string): number | undefined {
  const value = output[key];

  return typeof value === "number" ? value : undefined;
}

export function outputString(value: unknown, fallback: string): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

export function isFailedVerifierOutput(value: unknown): value is {
  verifier: string;
  exitCode?: string | number | null;
  timedOut?: boolean;
  evidenceId?: string;
} {
  return (
    isRecord(value) &&
    typeof value.verifier === "string" &&
    (value.exitCode !== 0 || value.timedOut === true)
  );
}

function isBudgetReason(value: unknown): value is CodexDirectBudgetSummary["reason"] {
  return value === "turns" || value === "tool_calls" || value === "failed_tool_calls";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
