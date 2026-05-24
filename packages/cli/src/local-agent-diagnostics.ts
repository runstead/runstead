import type { JsonObject, Task } from "@runstead/core";

import type {
  CodexDirectBudgetSummary,
  CodexDirectInterruptionSummary
} from "./codex-direct-worker.js";
import type { RunTaskVerifierCommandResult } from "./verifier-runner.js";

export interface LocalAgentDiagnostic {
  cause: string;
  likelyReason?: string;
  retry?: string;
}

export interface LocalAgentRunDiagnosticInput {
  task: Task;
  status: string;
  summary: string;
  workerResult?:
    | {
        failedToolCalls?: number;
        warnings?: string[];
        budget?: CodexDirectBudgetSummary;
        interruption?: CodexDirectInterruptionSummary;
        status?: string;
      }
    | undefined;
  verifierResults?: RunTaskVerifierCommandResult[] | undefined;
  approval?:
    | {
        id: string;
        reason: string;
      }
    | undefined;
}

export function diagnoseLocalAgentRun(
  input: LocalAgentRunDiagnosticInput
): LocalAgentDiagnostic[] {
  const workerStatus = input.workerResult?.status ?? input.status;

  return compactDiagnostics([
    approvalDiagnostic(input.task.id, input.approval),
    interruptionDiagnostic(input.workerResult?.interruption),
    budgetDiagnostic(input.workerResult?.budget),
    verifierDiagnostic(input.verifierResults),
    policyDeniedDiagnostic(input.status, input.summary),
    codexAuthDiagnostic(workerStatus, input.summary),
    codexModelDiagnostic(workerStatus, input.summary),
    failedToolCallsDiagnostic(input.workerResult?.failedToolCalls)
  ]);
}

export function diagnoseLocalAgentTask(task: Task): LocalAgentDiagnostic[] {
  const output = task.output ?? {};
  const workerStatus = stringOutput(output, "status") || task.status;

  return compactDiagnostics([
    approvalDiagnostic(task.id, approvalFromOutput(output)),
    interruptionDiagnostic(interruptionFromOutput(output.interruption)),
    budgetDiagnostic(budgetFromOutput(output.budget)),
    verifierOutputDiagnostic(output),
    policyDeniedDiagnostic(task.status, stringOutput(output, "summary")),
    codexAuthDiagnostic(workerStatus, stringOutput(output, "summary")),
    codexModelDiagnostic(workerStatus, stringOutput(output, "summary")),
    failedToolCallsDiagnostic(numberOutput(output, "failedToolCalls"))
  ]);
}

export function formatLocalAgentDiagnostics(
  diagnostics: LocalAgentDiagnostic[]
): string[] {
  if (diagnostics.length === 0) {
    return [];
  }

  return [
    "Diagnosis:",
    ...diagnostics.flatMap((diagnostic) => [
      `- Cause: ${diagnostic.cause}`,
      ...(diagnostic.likelyReason === undefined
        ? []
        : [`  Likely reason: ${diagnostic.likelyReason}`]),
      ...(diagnostic.retry === undefined ? [] : [`  Retry: ${diagnostic.retry}`])
    ])
  ];
}

function approvalDiagnostic(
  taskId: string,
  approval: { id: string; reason: string } | undefined
): LocalAgentDiagnostic | undefined {
  return approval === undefined
    ? undefined
    : {
        cause: `approval required (${approval.id}): ${approval.reason}`,
        likelyReason: "A governed action needs explicit local approval.",
        retry: `runstead approval approve ${approval.id} && runstead agent resume ${taskId}`
      };
}

function interruptionDiagnostic(
  interruption: CodexDirectInterruptionSummary | undefined
): LocalAgentDiagnostic | undefined {
  if (interruption === undefined) {
    return undefined;
  }

  return {
    cause: `interrupted:${interruption.reason}`,
    likelyReason:
      "The Codex Direct model request exceeded its configured response timeout while Runstead stayed alive.",
    retry: interruption.retryCommand
  };
}

function budgetDiagnostic(
  budget: CodexDirectBudgetSummary | undefined
): LocalAgentDiagnostic | undefined {
  if (budget === undefined) {
    return undefined;
  }

  return {
    cause: budgetCause(budget),
    likelyReason:
      budget.reason === "turns" || budget.reason === "tool_calls"
        ? "The prompt or preset needed more exploration than its configured budget."
        : "The worker encountered too many recoverable tool errors.",
    retry: budgetRetry(budget)
  };
}

function verifierDiagnostic(
  results: RunTaskVerifierCommandResult[] | undefined
): LocalAgentDiagnostic | undefined {
  const failed = results?.find((result) => result.exitCode !== 0 || result.timedOut);

  return failed === undefined
    ? undefined
    : {
        cause: `verifier failed: ${failed.verifier} exit=${failed.exitCode ?? "unknown"} evidence=${failed.evidenceId}`,
        likelyReason: "The model completed, but Runstead verification did not pass.",
        retry: `inspect evidence ${failed.evidenceId}, fix the failure, then rerun the verifier`
      };
}

function verifierOutputDiagnostic(
  output: JsonObject
): LocalAgentDiagnostic | undefined {
  if (stringOutput(output, "verifierStatus") !== "failed") {
    return undefined;
  }

  const verifiers: unknown = output.verifiers;
  const failed = Array.isArray(verifiers)
    ? verifiers.find(isFailedVerifierOutput)
    : undefined;

  if (failed === undefined) {
    return {
      cause: "verifier failed",
      likelyReason: "The model completed, but Runstead verification did not pass."
    };
  }

  const exitCode = outputString(failed.exitCode, "unknown");
  const evidenceId = outputString(failed.evidenceId, "unknown");

  return {
    cause: `verifier failed: ${failed.verifier} exit=${exitCode} evidence=${evidenceId}`,
    likelyReason: "The model completed, but Runstead verification did not pass.",
    retry: `inspect evidence ${evidenceId}`
  };
}

function policyDeniedDiagnostic(
  status: string,
  summary: string
): LocalAgentDiagnostic | undefined {
  const normalized = summary.toLowerCase();

  return status === "blocked" || normalized.includes("denied")
    ? {
        cause: summary.length === 0 ? "policy denied the requested action" : summary,
        likelyReason: "A Runstead policy rule denied a tool or worker action.",
        retry: "adjust the prompt scope, allowed paths, or repo-maintenance policy"
      }
    : undefined;
}

function codexAuthDiagnostic(
  status: string,
  summary: string
): LocalAgentDiagnostic | undefined {
  if (status !== "failed") {
    return undefined;
  }

  const normalized = summary.toLowerCase();
  const authSignals = ["401", "unauthorized", "access token", "credentials", "login"];

  return normalized.includes("codex") &&
    authSignals.some((signal) => normalized.includes(signal))
    ? {
        cause: summary,
        likelyReason: "Codex Direct credentials are missing, expired, or rejected.",
        retry: "runstead codex status, then runstead codex login if needed"
      }
    : undefined;
}

function codexModelDiagnostic(
  status: string,
  summary: string
): LocalAgentDiagnostic | undefined {
  if (status !== "failed") {
    return undefined;
  }

  const normalized = summary.toLowerCase();
  const modelSignals = ["not found", "does not exist", "unsupported"];

  return normalized.includes("model") &&
    modelSignals.some((signal) => normalized.includes(signal))
    ? {
        cause: summary,
        likelyReason: "The selected Codex model is unavailable to the current account.",
        retry: "runstead codex models --refresh"
      }
    : undefined;
}

function failedToolCallsDiagnostic(
  failedToolCalls: number | undefined
): LocalAgentDiagnostic | undefined {
  return failedToolCalls === undefined || failedToolCalls === 0
    ? undefined
    : {
        cause: `completed with ${failedToolCalls} recoverable failed tool call${failedToolCalls === 1 ? "" : "s"}`,
        likelyReason:
          "At least one tool returned an error such as a missing file or invalid argument.",
        retry: "review the failed tool-call audit entries before trusting the summary"
      };
}

function budgetCause(budget: CodexDirectBudgetSummary): string {
  switch (budget.reason) {
    case "turns":
      return `turn budget exhausted after ${budget.maxTurns} turns and ${budget.toolCalls} tool calls`;
    case "tool_calls":
      return `tool budget exhausted after ${budget.toolCalls} tool calls`;
    case "failed_tool_calls":
      return `failed-tool budget exhausted after ${budget.failedToolCalls} failed tool calls`;
  }
}

function budgetRetry(budget: CodexDirectBudgetSummary): string {
  switch (budget.reason) {
    case "turns":
      return "rerun with a narrower preset or a higher --max-turns budget";
    case "tool_calls":
      return "rerun with a narrower preset or a higher --max-tool-calls budget";
    case "failed_tool_calls":
      return "rerun with a narrower prompt after checking missing paths or invalid tool arguments";
  }
}

function approvalFromOutput(
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

function interruptionFromOutput(
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

function budgetFromOutput(value: unknown): CodexDirectBudgetSummary | undefined {
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

function stringOutput(output: JsonObject, key: string): string {
  const value = output[key];

  return typeof value === "string" ? value : "";
}

function numberOutput(output: JsonObject, key: string): number | undefined {
  const value = output[key];

  return typeof value === "number" ? value : undefined;
}

function outputString(value: unknown, fallback: string): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

function isFailedVerifierOutput(value: unknown): value is {
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

function compactDiagnostics(
  diagnostics: (LocalAgentDiagnostic | undefined)[]
): LocalAgentDiagnostic[] {
  const seen = new Set<string>();
  const compacted: LocalAgentDiagnostic[] = [];

  for (const diagnostic of diagnostics) {
    if (diagnostic === undefined || seen.has(diagnostic.cause)) {
      continue;
    }
    seen.add(diagnostic.cause);
    compacted.push(diagnostic);
  }

  return compacted;
}

function isBudgetReason(value: unknown): value is CodexDirectBudgetSummary["reason"] {
  return value === "turns" || value === "tool_calls" || value === "failed_tool_calls";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
