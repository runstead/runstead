import {
  diagnoseLocalAgentRun,
  formatLocalAgentDiagnostics,
  type LocalAgentRunDiagnosticInput
} from "./local-agent-diagnostics.js";
import {
  formatExecutionSemanticsLines,
  formatLocalAgentWorkerResultLines,
  isCodexDirectLocalAgentWorkerResult
} from "./local-agent-result.js";
import {
  formatLocalAgentAuditSummary,
  formatLocalAgentWarnings
} from "./local-agent-report.js";
import type {
  RunLocalAgentTaskResult,
  UndoLocalAgentTaskResult
} from "./local-agent-types.js";

export function formatLocalAgentRunReport(result: RunLocalAgentTaskResult): string {
  return [
    "Runstead agent run",
    `Task: ${result.task.id}`,
    `Status: ${result.status}`,
    ...formatExecutionSemanticsLines(result.execution),
    ...(result.workerResult === undefined
      ? []
      : formatLocalAgentWorkerResultLines(result.workerResult)),
    ...formatLocalAgentWarnings(
      result.workerResult !== undefined &&
        isCodexDirectLocalAgentWorkerResult(result.workerResult)
        ? result.workerResult.warnings
        : undefined
    ),
    ...(result.checkpoint === undefined ? [] : [`Checkpoint: ${result.checkpoint.id}`]),
    ...(result.verifierResults === undefined
      ? []
      : [
          "Verifiers:",
          ...result.verifierResults.map(
            (command) =>
              `  ${command.verifier}: exit=${command.exitCode ?? "unknown"} evidence=${command.evidenceId}`
          )
        ]),
    ...(result.approval === undefined
      ? []
      : [`Approval: waiting ${result.approval.id}`]),
    ...formatLocalAgentDiagnostics(
      diagnoseLocalAgentRun(localAgentRunDiagnosticsInput(result))
    ),
    `Summary: ${result.summary}`,
    ...formatLocalAgentAuditSummary(result.audit)
  ].join("\n");
}

export function formatLocalAgentUndoReport(result: UndoLocalAgentTaskResult): string {
  return [
    "Runstead agent undo",
    `Task: ${result.task.id}`,
    `Checkpoint: ${result.checkpointId}`,
    `HEAD: ${result.restore.currentHead ?? "unknown"} -> ${result.restore.checkpoint.head ?? "unknown"}`,
    `Tracked patch restored: ${result.restore.restoredTrackedPatch ? "yes" : "no"}`,
    `Untracked files restored: ${result.restore.restoredUntrackedFiles.length}`,
    `Untracked files removed: ${result.restore.removedUntrackedFiles.length}`
  ].join("\n");
}

export function localAgentRunExitCode(result: RunLocalAgentTaskResult): number {
  return result.status === "completed" || result.status === "completed_with_warnings"
    ? 0
    : 1;
}

function localAgentRunDiagnosticsInput(
  result: RunLocalAgentTaskResult
): LocalAgentRunDiagnosticInput {
  if (
    result.workerResult === undefined ||
    !isCodexDirectLocalAgentWorkerResult(result.workerResult)
  ) {
    return {
      task: result.task,
      status: result.status,
      summary: result.summary,
      ...(result.verifierResults === undefined
        ? {}
        : { verifierResults: result.verifierResults }),
      ...(result.approval === undefined ? {} : { approval: result.approval })
    };
  }

  return {
    task: result.task,
    status: result.status,
    summary: result.summary,
    workerResult: {
      status: result.workerResult.status,
      failedToolCalls: result.workerResult.failedToolCalls,
      warnings: result.workerResult.warnings,
      ...(result.workerResult.interruption === undefined
        ? {}
        : { interruption: result.workerResult.interruption }),
      ...(result.workerResult.budget === undefined
        ? {}
        : { budget: result.workerResult.budget })
    },
    ...(result.verifierResults === undefined
      ? {}
      : { verifierResults: result.verifierResults }),
    ...(result.approval === undefined ? {} : { approval: result.approval })
  };
}
