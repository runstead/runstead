import type { CreateCiRepairTaskFromWorkflowRunResult } from "./ci-repair.js";

export function formatCiRepairTaskReport(
  result: CreateCiRepairTaskFromWorkflowRunResult
): string {
  if (result.status === "ignored") {
    return [
      "Runstead CI repair task",
      "Status: ignored",
      `Reason: ${result.reason}`,
      `Task: ${result.task.id}`,
      `Task status: ${result.taskStatus}`,
      `Run: ${result.workflowRun.runId}`,
      `Workflow: ${result.workflowRun.workflowName ?? "unknown"}`,
      `Conclusion: ${result.workflowRun.conclusion ?? "none"}`,
      `Message: ${result.error}`
    ].join("\n");
  }

  return [
    "Runstead CI repair task",
    "Status: created",
    `Task: ${result.task.id}`,
    `Run: ${result.workflowRun.runId}`,
    `Workflow: ${result.workflowRun.workflowName ?? "unknown"}`,
    `Conclusion: ${result.workflowRun.conclusion ?? "none"}`,
    `Evidence: ${result.evidence.id}`,
    `Log bytes: ${result.log.byteLength}`
  ].join("\n");
}
