import type { JsonObject } from "@runstead/core";

import type { WorkspaceCheckpoint } from "./checkpoints.js";
import { CODEX_DIRECT_WORKER_KIND } from "./codex-direct-worker.js";
import type {
  CiRepairWorkerResult,
  CodexDirectCiRepairWorkerResult
} from "./ci-repair-orchestrator-types.js";
import type { WrappedWorkerRunResult } from "./wrapped-worker.js";

export function workerOutput(workerResult: CiRepairWorkerResult): JsonObject {
  if (isCodexDirectWorkerResult(workerResult)) {
    return {
      worker: workerResult.worker,
      model: workerResult.model,
      modelProvider: workerResult.modelProvider,
      status: workerResult.status,
      exitCode: workerResult.exitCode,
      summary: workerResult.summary,
      toolCalls: workerResult.toolCalls,
      ...(workerResult.approval === undefined
        ? {}
        : { approvalId: workerResult.approval.id }),
      ...(workerCheckpointBefore(workerResult) === undefined
        ? {}
        : { checkpointBefore: workerCheckpointBefore(workerResult)?.id })
    };
  }

  return {
    worker: workerResult.worker,
    command: workerResult.command,
    args: redactedWorkerArgs(workerResult),
    governance: workerResult.governance,
    exitCode: workerResult.exitCode,
    outputValidation: workerResult.outputValidation,
    progress: workerResult.progress,
    ...(workerResult.structuredOutput === undefined
      ? {}
      : {
          structuredOutput: {
            needsApproval: workerResult.structuredOutput.needs_approval
          }
        }),
    stdoutBytes: Buffer.byteLength(workerResult.stdout, "utf8"),
    stderrBytes: Buffer.byteLength(workerResult.stderr, "utf8"),
    stdoutOmitted: workerResult.stdout.length > 0,
    stderrOmitted: workerResult.stderr.length > 0,
    ...(workerResult.checkpointBefore === undefined
      ? {}
      : { checkpointBefore: workerResult.checkpointBefore.id })
  };
}

export function durableWorkerResult(
  workerResult: CiRepairWorkerResult
): CiRepairWorkerResult {
  if (isCodexDirectWorkerResult(workerResult)) {
    return {
      ...workerResult,
      summary:
        workerResult.summary.length === 0
          ? ""
          : truncateDurableText(workerResult.summary)
    };
  }

  const omitted = "[omitted from Runstead durable state]";
  const durable = { ...workerResult };

  delete durable.structuredOutput;

  return {
    ...durable,
    prompt: omitted,
    args: redactedWorkerArgs(workerResult),
    stdout: workerResult.stdout.length === 0 ? "" : omitted,
    stderr: workerResult.stderr.length === 0 ? "" : omitted
  };
}

export function isCodexDirectWorkerResult(
  workerResult: CiRepairWorkerResult
): workerResult is CodexDirectCiRepairWorkerResult {
  return workerResult.worker === CODEX_DIRECT_WORKER_KIND;
}

export function workerCheckpointBefore(
  workerResult: CiRepairWorkerResult
): WorkspaceCheckpoint | undefined {
  return isCodexDirectWorkerResult(workerResult)
    ? workerResult.checkpointBefore
    : workerResult.checkpointBefore;
}

export function workerFailureText(workerResult: CiRepairWorkerResult): string {
  return isCodexDirectWorkerResult(workerResult)
    ? workerResult.summary
    : workerResult.stderr;
}

function redactedWorkerArgs(workerResult: WrappedWorkerRunResult): string[] {
  const omitted = "[omitted from Runstead durable state]";

  return workerResult.args.map((arg) => (arg === workerResult.prompt ? omitted : arg));
}

function truncateDurableText(value: string, maxLength = 1000): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}
