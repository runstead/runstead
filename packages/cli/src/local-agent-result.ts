import type { JsonObject } from "@runstead/core";

import type { WorkspaceCheckpoint } from "./checkpoints.js";
export {
  formatExecutionSemanticsLines,
  formatLocalAgentWorkerResultLines
} from "./local-agent-result-format.js";
export { localAgentFailureFromError } from "./local-agent-result-failure.js";
export {
  isCodexDirectLocalAgentWorkerResult,
  localAgentExecutionSemantics,
  localAgentFinalTaskStatus,
  localAgentResultStatus,
  localAgentWorkerCompleted,
  localAgentWorkerRunStatus
} from "./local-agent-result-semantics.js";
import {
  isCodexDirectLocalAgentWorkerResult,
  localAgentExecutionSemantics
} from "./local-agent-result-semantics.js";
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
