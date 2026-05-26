import type { JsonObject, Task } from "@runstead/core";
import type { RuntimeExecutionSemantics } from "@runstead/runtime";

import type { WorkspaceCheckpoint } from "./checkpoints.js";
import type { CodexDirectWorkerResult } from "./codex-direct-worker.js";
import {
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "./governed-action.js";

export function localAgentFailureFromError(
  error: unknown,
  checkpoint?: WorkspaceCheckpoint
): {
  taskStatus: Task["status"];
  workerStatus: "failed" | "waiting_approval" | "blocked";
  resultStatus:
    | "completed"
    | "completed_with_warnings"
    | "waiting_approval"
    | "interrupted"
    | "blocked"
    | "failed";
  output: JsonObject;
  execution: RuntimeExecutionSemantics;
  approval?: CodexDirectWorkerResult["approval"];
} {
  if (error instanceof ToolActionApprovalRequiredError) {
    const approval = {
      id: error.approval.id,
      actionId: error.approval.actionId,
      policyDecisionId: error.policyDecision.id,
      reason: error.approval.reason
    };

    return {
      taskStatus: "waiting_approval",
      workerStatus: "waiting_approval",
      resultStatus: "waiting_approval",
      output: {
        summary: error.message,
        execution: localAgentFailureExecution("approval_waiting"),
        ...(checkpoint === undefined ? {} : { checkpointId: checkpoint.id }),
        approval
      },
      execution: localAgentFailureExecution("approval_waiting"),
      approval
    };
  }

  if (error instanceof ToolActionDeniedError) {
    return {
      taskStatus: "blocked",
      workerStatus: "blocked",
      resultStatus: "blocked",
      output: {
        summary: error.message,
        execution: localAgentFailureExecution("blocked"),
        ...(checkpoint === undefined ? {} : { checkpointId: checkpoint.id })
      },
      execution: localAgentFailureExecution("blocked")
    };
  }

  const execution = localAgentFailureExecution("failed");

  return {
    taskStatus: "failed",
    workerStatus: "failed",
    resultStatus: "failed",
    output: {
      summary: error instanceof Error ? error.message : String(error),
      execution,
      ...(checkpoint === undefined ? {} : { checkpointId: checkpoint.id })
    },
    execution
  };
}

function localAgentFailureExecution(
  agentCompletion: RuntimeExecutionSemantics["agentCompletion"]
): RuntimeExecutionSemantics {
  return {
    implementation: "not_applied",
    verification: "skipped",
    agentCompletion
  };
}
