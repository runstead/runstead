import type { JsonObject, Task } from "@runstead/core";
import {
  runtimeExecutionSemantics,
  runtimeFinalTaskStatus,
  runtimeTaskResultStatus,
  runtimeWorkerRunStatusFromTaskStatus,
  type RuntimeExecutionSemantics,
  type RuntimeVerifierOutcome,
  type RuntimeWorkerOutcome
} from "@runstead/runtime";

import type { WorkspaceCheckpoint } from "./checkpoints.js";
import {
  CODEX_DIRECT_WORKER_KIND,
  type CodexDirectWorkerResult
} from "./codex-direct-worker.js";
import {
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "./governed-action.js";
export {
  formatExecutionSemanticsLines,
  formatLocalAgentWorkerResultLines
} from "./local-agent-result-format.js";
import {
  localNativeWorkerGovernanceOutput,
  localWrappedWorkerGovernanceOutput,
  redactedLocalWrappedWorkerArgs,
  wrappedWorkerDefaultModelSource,
  wrappedWorkerModel
} from "./local-agent-worker-output.js";
export type {
  LocalAgentWorkerGovernanceOutput,
  LocalAgentWorkerGovernanceProfile,
  LocalAgentWorkerResult
} from "./local-agent-worker-types.js";
import type { LocalAgentWorkerResult } from "./local-agent-worker-types.js";
import type { RunTaskVerifiersResult } from "./verifier-runner.js";

export function localAgentFinalTaskStatus(
  workerResult: LocalAgentWorkerResult,
  verifierResult?: RunTaskVerifiersResult
): Task["status"] {
  const worker = localAgentWorkerOutcome(workerResult);
  const verifier = localAgentEffectiveVerifierOutcome(workerResult, verifierResult);

  return verifier === undefined
    ? runtimeFinalTaskStatus({ worker })
    : runtimeFinalTaskStatus({ worker, verifier });
}

export function localAgentResultStatus(
  status: Task["status"],
  workerResult?: LocalAgentWorkerResult
):
  | "completed"
  | "completed_with_warnings"
  | "waiting_approval"
  | "interrupted"
  | "blocked"
  | "failed" {
  return runtimeTaskResultStatus({
    taskStatus: status,
    ...(workerResult === undefined
      ? {}
      : { worker: localAgentWorkerOutcome(workerResult) })
  });
}

export function localAgentWorkerRunStatus(
  status: Task["status"]
): "completed" | "waiting_approval" | "interrupted" | "blocked" | "failed" {
  return runtimeWorkerRunStatusFromTaskStatus(status);
}

export function localAgentFinalSummary(
  workerResult: LocalAgentWorkerResult,
  verifierResult?: RunTaskVerifiersResult
): string {
  if (!isCodexDirectLocalAgentWorkerResult(workerResult)) {
    const summary =
      workerResult.structuredOutput?.summary ??
      (workerResult.stderr.length === 0
        ? `Wrapped worker exited ${workerResult.exitCode}`
        : workerResult.stderr.trim());

    if (verifierResult === undefined) {
      return summary;
    }

    const verifierSummary = verifierResult.task.output?.summary;

    return typeof verifierSummary === "string" && verifierSummary.length > 0
      ? `${summary} Verifiers: ${verifierSummary}`
      : summary;
  }

  if (verifierResult === undefined) {
    return workerResult.summary;
  }

  const verifierSummary = verifierResult.task.output?.summary;

  return typeof verifierSummary === "string" && verifierSummary.length > 0
    ? `${workerResult.summary} Verifiers: ${verifierSummary}`
    : workerResult.summary;
}

export function localAgentExecutionSemantics(input: {
  workerResult: LocalAgentWorkerResult;
  verifierResult?: RunTaskVerifiersResult;
}): RuntimeExecutionSemantics {
  const worker = localAgentWorkerOutcome(input.workerResult);
  const verifier = localAgentEffectiveVerifierOutcome(
    input.workerResult,
    input.verifierResult
  );

  return verifier === undefined
    ? runtimeExecutionSemantics({ worker })
    : runtimeExecutionSemantics({ worker, verifier });
}

export function localAgentTaskOutput(input: {
  workerResult: LocalAgentWorkerResult;
  summary: string;
  checkpoint?: WorkspaceCheckpoint;
  verifierResult?: RunTaskVerifiersResult;
}): JsonObject {
  if (!isCodexDirectLocalAgentWorkerResult(input.workerResult)) {
    return {
      summary: input.summary,
      worker: input.workerResult.worker,
      status: input.workerResult.exitCode === 0 ? "completed" : "failed",
      exitCode: input.workerResult.exitCode,
      command: input.workerResult.command,
      args: redactedLocalWrappedWorkerArgs(input.workerResult),
      governance: localWrappedWorkerGovernanceOutput(input.workerResult),
      execution: localAgentExecutionSemantics(input),
      outputValidation: input.workerResult.outputValidation,
      stdoutBytes: Buffer.byteLength(input.workerResult.stdout, "utf8"),
      stderrBytes: Buffer.byteLength(input.workerResult.stderr, "utf8"),
      stdoutOmitted: input.workerResult.stdout.length > 0,
      stderrOmitted: input.workerResult.stderr.length > 0,
      ...(wrappedWorkerModel(input.workerResult) === undefined
        ? { modelSource: wrappedWorkerDefaultModelSource(input.workerResult) }
        : {
            model: wrappedWorkerModel(input.workerResult),
            modelSource: "runstead_model_option"
          }),
      ...(input.checkpoint === undefined ? {} : { checkpointId: input.checkpoint.id }),
      ...(input.verifierResult === undefined
        ? {}
        : {
            verifiers: input.verifierResult.commandResults,
            verifierStatus: input.verifierResult.task.status
          })
    };
  }

  return {
    summary: input.summary,
    worker: input.workerResult.worker,
    model: input.workerResult.model,
    modelProvider: input.workerResult.modelProvider,
    status: input.workerResult.status,
    exitCode: input.workerResult.exitCode,
    toolCalls: input.workerResult.toolCalls,
    failedToolCalls: input.workerResult.failedToolCalls,
    workerRunId: input.workerResult.workerRun.id,
    governance: localNativeWorkerGovernanceOutput(),
    execution: localAgentExecutionSemantics(input),
    ...(input.workerResult.warnings.length === 0
      ? {}
      : { warnings: input.workerResult.warnings }),
    ...(input.workerResult.interruption === undefined
      ? {}
      : { interruption: input.workerResult.interruption }),
    ...(input.workerResult.budget === undefined
      ? {}
      : { budget: input.workerResult.budget }),
    ...(input.checkpoint === undefined ? {} : { checkpointId: input.checkpoint.id }),
    ...(input.verifierResult === undefined
      ? {}
      : {
          verifiers: input.verifierResult.commandResults,
          verifierStatus: input.verifierResult.task.status
        }),
    ...(input.workerResult.approval === undefined
      ? {}
      : { approval: input.workerResult.approval })
  };
}

export function localAgentWorkerOutput(input: {
  workerResult: LocalAgentWorkerResult;
  summary?: string;
  checkpoint?: WorkspaceCheckpoint;
  verifierResult?: RunTaskVerifiersResult;
}): JsonObject {
  if (!isCodexDirectLocalAgentWorkerResult(input.workerResult)) {
    return {
      worker: input.workerResult.worker,
      command: input.workerResult.command,
      args: redactedLocalWrappedWorkerArgs(input.workerResult),
      governance: localWrappedWorkerGovernanceOutput(input.workerResult),
      execution: localAgentExecutionSemantics(input),
      status: input.workerResult.exitCode === 0 ? "completed" : "failed",
      exitCode: input.workerResult.exitCode,
      outputValidation: input.workerResult.outputValidation,
      progress: input.workerResult.progress,
      stdoutBytes: Buffer.byteLength(input.workerResult.stdout, "utf8"),
      stderrBytes: Buffer.byteLength(input.workerResult.stderr, "utf8"),
      stdoutOmitted: input.workerResult.stdout.length > 0,
      stderrOmitted: input.workerResult.stderr.length > 0,
      ...(input.summary === undefined ? {} : { summary: input.summary }),
      ...(wrappedWorkerModel(input.workerResult) === undefined
        ? { modelSource: wrappedWorkerDefaultModelSource(input.workerResult) }
        : {
            model: wrappedWorkerModel(input.workerResult),
            modelSource: "runstead_model_option"
          }),
      ...(input.checkpoint === undefined ? {} : { checkpointId: input.checkpoint.id }),
      ...(input.verifierResult === undefined
        ? {}
        : {
            verifiers: input.verifierResult.commandResults,
            verifierStatus: input.verifierResult.task.status
          })
    };
  }

  return {
    worker: input.workerResult.worker,
    model: input.workerResult.model,
    modelProvider: input.workerResult.modelProvider,
    status: input.workerResult.status,
    exitCode: input.workerResult.exitCode,
    toolCalls: input.workerResult.toolCalls,
    failedToolCalls: input.workerResult.failedToolCalls,
    summary: input.summary ?? input.workerResult.summary,
    governance: localNativeWorkerGovernanceOutput(),
    execution: localAgentExecutionSemantics(input),
    ...(input.workerResult.warnings.length === 0
      ? {}
      : { warnings: input.workerResult.warnings }),
    ...(input.workerResult.interruption === undefined
      ? {}
      : { interruption: input.workerResult.interruption }),
    ...(input.workerResult.budget === undefined
      ? {}
      : { budget: input.workerResult.budget }),
    ...(input.checkpoint === undefined ? {} : { checkpointId: input.checkpoint.id }),
    ...(input.verifierResult === undefined
      ? {}
      : {
          verifiers: input.verifierResult.commandResults,
          verifierStatus: input.verifierResult.task.status
        })
  };
}

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

export function isCodexDirectLocalAgentWorkerResult(
  workerResult: LocalAgentWorkerResult
): workerResult is CodexDirectWorkerResult {
  return workerResult.worker === CODEX_DIRECT_WORKER_KIND;
}

export function localAgentWorkerCompleted(
  workerResult: LocalAgentWorkerResult
): boolean {
  return isCodexDirectLocalAgentWorkerResult(workerResult)
    ? workerResult.status === "completed" ||
        (workerResult.status === "failed" &&
          (workerResult.budget !== undefined ||
            workerResult.toolCalls > 0 ||
            workerResult.execution.verification !== "skipped"))
    : workerResult.exitCode === 0;
}

function localAgentEffectiveVerifierOutcome(
  workerResult: LocalAgentWorkerResult,
  verifierResult: RunTaskVerifiersResult | undefined
): RuntimeVerifierOutcome | undefined {
  const explicit = localAgentVerifierOutcome(verifierResult);

  if (explicit !== undefined) {
    return explicit;
  }

  if (
    isCodexDirectLocalAgentWorkerResult(workerResult) &&
    workerResult.execution.verification !== "skipped"
  ) {
    return { status: workerResult.execution.verification };
  }

  return undefined;
}

function localAgentWorkerOutcome(
  workerResult: LocalAgentWorkerResult
): RuntimeWorkerOutcome {
  if (!isCodexDirectLocalAgentWorkerResult(workerResult)) {
    return {
      kind: "wrapped",
      exitCode: workerResult.exitCode
    };
  }

  return {
    kind: "governed",
    status: workerResult.status,
    toolCalls: workerResult.toolCalls,
    ...(workerResult.budget === undefined ? {} : { budgetExhausted: true })
  };
}

function localAgentVerifierOutcome(
  verifierResult: RunTaskVerifiersResult | undefined
): RuntimeVerifierOutcome | undefined {
  if (verifierResult === undefined) {
    return undefined;
  }

  return {
    status: localAgentVerifiersPassed(verifierResult) ? "passed" : "failed",
    taskStatus: verifierResult.task.status
  };
}

function localAgentVerifiersPassed(
  verifierResult: RunTaskVerifiersResult | undefined
): boolean {
  return (
    verifierResult !== undefined &&
    verifierResult.commandResults.length > 0 &&
    verifierResult.commandResults.every(
      (result) => result.exitCode === 0 && result.timedOut === false
    )
  );
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
