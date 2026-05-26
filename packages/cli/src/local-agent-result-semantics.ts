import type { Task } from "@runstead/core";
import {
  runtimeExecutionSemantics,
  runtimeFinalTaskStatus,
  runtimeTaskResultStatus,
  runtimeWorkerRunStatusFromTaskStatus,
  type RuntimeExecutionSemantics,
  type RuntimeVerifierOutcome,
  type RuntimeWorkerOutcome
} from "@runstead/runtime";

import {
  CODEX_DIRECT_WORKER_KIND,
  type CodexDirectWorkerResult
} from "./codex-direct-worker.js";
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
