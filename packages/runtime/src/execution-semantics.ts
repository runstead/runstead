import type { JsonObject, Task, WorkerRun } from "@runstead/core";

export type RuntimeAgentImplementationStatus = "applied" | "not_applied";
export type RuntimeVerificationStatus = "passed" | "failed" | "skipped";
export type RuntimeAgentCompletionStatus =
  | "completed"
  | "budget_exhausted"
  | "approval_waiting"
  | "interrupted"
  | "blocked"
  | "failed";

export type RuntimeTaskResultStatus =
  | "completed"
  | "completed_with_warnings"
  | "waiting_approval"
  | "interrupted"
  | "blocked"
  | "failed";
export type RuntimeFinalWorkerRunStatus = Exclude<WorkerRun["status"], "running">;

export interface RuntimeExecutionSemantics extends JsonObject {
  implementation: RuntimeAgentImplementationStatus;
  verification: RuntimeVerificationStatus;
  agentCompletion: RuntimeAgentCompletionStatus;
}

export type RuntimeWorkerOutcome =
  | {
      kind: "wrapped";
      exitCode: number;
    }
  | {
      kind: "governed";
      status:
        | "completed"
        | "failed"
        | "interrupted"
        | "waiting_approval"
        | "blocked";
      toolCalls: number;
      budgetExhausted?: boolean;
    };

export interface RuntimeVerifierOutcome {
  status: RuntimeVerificationStatus;
  taskStatus?: Task["status"];
}

export function runtimeAgentCompletionStatus(
  worker: RuntimeWorkerOutcome
): RuntimeAgentCompletionStatus {
  if (worker.kind === "wrapped") {
    return worker.exitCode === 0 ? "completed" : "failed";
  }

  if (worker.status === "completed") {
    return "completed";
  }

  if (worker.status === "waiting_approval") {
    return "approval_waiting";
  }

  if (worker.status === "interrupted") {
    return "interrupted";
  }

  if (worker.status === "blocked") {
    return "blocked";
  }

  return worker.budgetExhausted === true ? "budget_exhausted" : "failed";
}

export function runtimeImplementationStatus(input: {
  worker: RuntimeWorkerOutcome;
  verifier?: RuntimeVerifierOutcome;
}): RuntimeAgentImplementationStatus {
  if (input.verifier?.status === "passed") {
    return "applied";
  }

  if (input.worker.kind === "wrapped") {
    return input.worker.exitCode === 0 ? "applied" : "not_applied";
  }

  return input.worker.status === "completed" && input.worker.toolCalls > 0
    ? "applied"
    : "not_applied";
}

export function runtimeExecutionSemantics(input: {
  worker: RuntimeWorkerOutcome;
  verifier?: RuntimeVerifierOutcome;
}): RuntimeExecutionSemantics {
  return {
    implementation: runtimeImplementationStatus(input),
    verification: input.verifier?.status ?? "skipped",
    agentCompletion: runtimeAgentCompletionStatus(input.worker)
  };
}

export function runtimeFinalTaskStatus(input: {
  worker: RuntimeWorkerOutcome;
  verifier?: RuntimeVerifierOutcome;
}): Task["status"] {
  if (input.worker.kind === "governed") {
    if (
      input.worker.status === "failed" &&
      input.worker.budgetExhausted === true &&
      input.verifier?.status === "passed"
    ) {
      return "completed";
    }

    if (input.worker.status !== "completed") {
      return runtimeTaskStatusFromWorkerStatus(input.worker.status);
    }

    return input.verifier?.taskStatus ?? "completed";
  }

  if (input.worker.exitCode !== 0) {
    return "failed";
  }

  return input.verifier?.taskStatus ?? "completed";
}

export function runtimeTaskResultStatus(input: {
  taskStatus: Task["status"];
  worker?: RuntimeWorkerOutcome;
}): RuntimeTaskResultStatus {
  switch (input.taskStatus) {
    case "completed":
      return input.worker?.kind === "governed" &&
        input.worker.status === "failed" &&
        input.worker.budgetExhausted === true
        ? "completed_with_warnings"
        : "completed";
    case "waiting_approval":
      return "waiting_approval";
    case "interrupted":
      return "interrupted";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    default:
      return "failed";
  }
}

export function runtimeWorkerRunStatusFromTaskStatus(
  taskStatus: Task["status"]
): RuntimeFinalWorkerRunStatus {
  switch (taskStatus) {
    case "completed":
      return "completed";
    case "waiting_approval":
      return "waiting_approval";
    case "interrupted":
      return "interrupted";
    case "blocked":
      return "blocked";
    default:
      return "failed";
  }
}

function runtimeTaskStatusFromWorkerStatus(
  status: Extract<RuntimeWorkerOutcome, { kind: "governed" }>["status"]
): Task["status"] {
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
