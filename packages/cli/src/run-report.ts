import type { Task } from "@runstead/core";

import { formatLocalAgentRunReport, localAgentRunExitCode } from "./local-agent.js";
import type { RunOnceResult } from "./run.js";

export function formatRunOnceReport(result: RunOnceResult): string {
  if (!result.ranTask) {
    return ["Runstead run --once", "Status: idle", "Reason: no queued task"].join("\n");
  }

  if (result.ciRepairResult !== undefined) {
    return [
      "Runstead run --once",
      `Task: ${result.task.id}`,
      `Type: ${result.task.type}`,
      `Status: ${result.task.status}`,
      `CI repair: ${result.ciRepairResult.status}`,
      `Branch: ${result.ciRepairResult.branchName}`,
      ...(result.ciRepairResult.pullRequest === undefined
        ? []
        : [`Pull request: ${result.ciRepairResult.pullRequest.url ?? "created"}`]),
      ...(result.ciRepairResult.approval === undefined
        ? []
        : [`Approval: waiting ${result.ciRepairResult.approval.id}`])
    ].join("\n");
  }

  if (result.localAgentResult !== undefined) {
    return [
      "Runstead run --once",
      ...formatLocalAgentRunReport(result.localAgentResult).split("\n").slice(1)
    ].join("\n");
  }

  if (result.task.status === "blocked" && result.commandResults === undefined) {
    return [
      "Runstead run --once",
      `Task: ${result.task.id}`,
      `Type: ${result.task.type}`,
      "Status: blocked",
      `Blocked: ${taskOutputReason(result.task) ?? "unsupported_task_type"}`
    ].join("\n");
  }

  return [
    "Runstead run --once",
    `Task: ${result.task.id}`,
    `Type: ${result.task.type}`,
    `Status: ${result.task.status}`,
    "Verifiers:",
    ...(result.commandResults ?? []).map(
      (command) =>
        `  ${command.verifier}: exit=${command.exitCode ?? "unknown"} evidence=${command.evidenceId}`
    )
  ].join("\n");
}

export function runOnceExitCode(result: RunOnceResult): number {
  if (result.ranTask && result.localAgentResult !== undefined) {
    return localAgentRunExitCode(result.localAgentResult);
  }

  return result.ranTask &&
    (result.task.status === "failed" ||
      result.task.status === "blocked" ||
      result.task.status === "waiting_approval")
    ? 1
    : 0;
}

function taskOutputReason(task: Task): string | undefined {
  const reason = task.output?.reason;

  return typeof reason === "string" ? reason : undefined;
}
