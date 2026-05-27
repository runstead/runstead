import type { WorkerRun } from "@runstead/core";
import type { RuntimeVerificationStatus } from "@runstead/runtime";

import type { CodexResponsesInputItem } from "../codex-responses-transport.js";
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
  CodexDirectWorkerOptions,
  CodexDirectWorkerResult
} from "./worker.js";
import { codexDirectBudgetSummary, codexDirectBudgetWarning } from "./budget-result.js";
import { completedWorkerResult } from "./worker-result.js";

export {
  codexDirectVerificationStatus,
  codexDirectWarningOptions,
  recordCodexDirectVerifierResult
} from "./verifier-result.js";
export { safeJsonObject } from "./tool-json.js";
export {
  codexDirectExecutionSemantics,
  completedWorkerResult,
  workerRunStatus
} from "./worker-result.js";
export { codexDirectBudgetSummary, codexDirectBudgetWarning } from "./budget-result.js";

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
