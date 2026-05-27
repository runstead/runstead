import type { WorkerRun } from "@runstead/core";
import {
  runtimeExecutionSemantics,
  type RuntimeExecutionSemantics,
  type RuntimeVerificationStatus,
  type RuntimeWorkerOutcome
} from "@runstead/runtime";

import { finishWorkerRun, type FinishWorkerRunOptions } from "../runtime-audit.js";
import { CODEX_DIRECT_WORKER_KIND } from "./constants.js";
import type {
  CodexDirectBudgetSummary,
  CodexDirectWorkerOptions,
  CodexDirectWorkerResult
} from "./worker-types.js";

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
