import type { CodexDirectBudgetSummary } from "./codex-direct-worker.js";
import type { LocalAgentDiagnostic } from "./local-agent-diagnostic-types.js";

export function budgetDiagnostic(
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
