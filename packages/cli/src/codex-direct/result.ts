import type { WorkerRun } from "@runstead/core";
import {
  runtimeExecutionSemantics,
  type RuntimeExecutionSemantics,
  type RuntimeVerificationStatus,
  type RuntimeWorkerOutcome
} from "@runstead/runtime";

import type { CodexResponsesInputItem } from "../codex-responses-transport.js";
import { finishWorkerRun, type FinishWorkerRunOptions } from "../runtime-audit.js";
import { CODEX_DIRECT_WORKER_KIND } from "./constants.js";
import { buildCodexDirectInstructions } from "./tool-definitions.js";
import {
  CodexDirectModelRetryExhaustedError,
  CodexDirectModelTimeoutError,
  modelRetryExhaustedInterruption,
  modelTimeoutInterruption,
  runGovernedModelInference
} from "./model-request.js";
import type {
  CodexDirectBudgetReason,
  CodexDirectBudgetSummary,
  CodexDirectWorkerOptions,
  CodexDirectWorkerResult
} from "./worker.js";

export {
  codexDirectVerificationStatus,
  codexDirectWarningOptions,
  recordCodexDirectVerifierResult,
  safeJsonObject
} from "./verifier-result.js";

export async function finalizeBudgetExceededWorkerResult(input: {
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

export function codexDirectBudgetSummary(input: {
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

export function codexDirectBudgetWarning(budget: CodexDirectBudgetSummary): string {
  switch (budget.reason) {
    case "turns":
      return `Codex Direct worker turn budget exhausted after ${budget.maxTurns} turns and ${budget.toolCalls} tool calls.`;
    case "tool_calls":
      return `Codex Direct worker tool budget exhausted after ${budget.toolCalls} tool calls.`;
    case "failed_tool_calls":
      return `Codex Direct worker failed-tool budget exhausted after ${budget.failedToolCalls} failed tool calls.`;
  }
}

export function completedWorkerResult(input: {
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

export function codexDirectExecutionSemantics(input: {
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

export function workerRunStatus(
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
