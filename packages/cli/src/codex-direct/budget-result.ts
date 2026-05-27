import type {
  CodexDirectBudgetReason,
  CodexDirectBudgetSummary,
  CodexDirectWorkerOptions
} from "./worker.js";

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
