import type { WorkerRun } from "@runstead/core";

import {
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "../governed-action.js";
import {
  completedWorkerResult,
  CodexDirectModelTimeoutError,
  modelTimeoutInterruption
} from "./tool-router.js";
import type {
  CodexDirectPendingPatchResumeOptions,
  CodexDirectWorkerResult
} from "./worker-types.js";

export function codexDirectPendingPatchResumeErrorResult(input: {
  error: unknown;
  options: CodexDirectPendingPatchResumeOptions;
  workerRun: WorkerRun;
}): CodexDirectWorkerResult {
  if (input.error instanceof ToolActionApprovalRequiredError) {
    return completedWorkerResult({
      options: input.options,
      workerRun: input.workerRun,
      status: "waiting_approval",
      exitCode: 2,
      summary: input.error.message,
      toolCalls: 1,
      failedToolCalls: 0,
      approval: {
        id: input.error.approval.id,
        actionId: input.error.approval.actionId,
        policyDecisionId: input.error.policyDecision.id,
        reason: input.error.approval.reason
      }
    });
  }

  if (input.error instanceof ToolActionDeniedError) {
    return completedWorkerResult({
      options: input.options,
      workerRun: input.workerRun,
      status: "blocked",
      exitCode: 3,
      summary: input.error.message,
      toolCalls: 1,
      failedToolCalls: 0
    });
  }

  if (input.error instanceof CodexDirectModelTimeoutError) {
    return completedWorkerResult({
      options: input.options,
      workerRun: input.workerRun,
      status: "interrupted",
      exitCode: 124,
      summary: input.error.message,
      toolCalls: 1,
      failedToolCalls: 0,
      warnings: [
        `Resumed from approved pending patch ${input.options.pendingPatch.approvalId}.`,
        "Codex Direct model request timed out; the task is recoverable with runstead resume."
      ],
      interruption: modelTimeoutInterruption(input.options, input.error)
    });
  }

  return completedWorkerResult({
    options: input.options,
    workerRun: input.workerRun,
    status: "failed",
    exitCode: 1,
    summary: input.error instanceof Error ? input.error.message : String(input.error),
    toolCalls: 1,
    failedToolCalls: 1
  });
}
