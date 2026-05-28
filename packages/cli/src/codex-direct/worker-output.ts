import type { RuntimeExecutionSemantics } from "@runstead/runtime";

import { CODEX_DIRECT_WORKER_KIND } from "./constants.js";
import type {
  CodexDirectBudgetSummary,
  CodexDirectWorkerResult
} from "./worker-types.js";

export function codexDirectWorkerOutput(input: {
  model: string;
  modelProvider: string;
  summary: string;
  execution: RuntimeExecutionSemantics;
  toolCalls: number;
  failedToolCalls: number;
  warnings: string[];
  interruption?: CodexDirectWorkerResult["interruption"];
  budget?: CodexDirectBudgetSummary;
  approval?: CodexDirectWorkerResult["approval"];
}) {
  return {
    worker: CODEX_DIRECT_WORKER_KIND,
    model: input.model,
    modelProvider: input.modelProvider,
    summary: input.summary,
    execution: input.execution,
    toolCalls: input.toolCalls,
    failedToolCalls: input.failedToolCalls,
    ...(input.interruption === undefined ? {} : { interruption: input.interruption }),
    ...(input.warnings.length === 0 ? {} : { warnings: input.warnings }),
    ...(input.budget === undefined ? {} : { budget: input.budget }),
    ...(input.approval === undefined ? {} : { approval: input.approval })
  };
}
