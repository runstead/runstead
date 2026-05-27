import type { RunCiRepairOrchestratorResult } from "./ci-repair-orchestrator-types.js";
import { isCodexDirectWorkerResult } from "./ci-repair-orchestrator-worker-output.js";

export { buildCiRepairPullRequestBody } from "./ci-repair-orchestrator-pr-body.js";

export function formatCiRepairOrchestratorReport(
  result: RunCiRepairOrchestratorResult
): string {
  if (result.status === "ignored") {
    if (result.ciRepair.status !== "ignored") {
      throw new Error(
        "Ignored CI repair orchestrator result is missing ignored intake"
      );
    }

    return [
      "Runstead CI repair orchestrator",
      "Status: ignored",
      `Reason: ${result.ciRepair.reason}`,
      `Task: ${result.ciRepair.task.id}`,
      `Task status: ${result.ciRepair.taskStatus}`,
      `Run: ${result.ciRepair.workflowRun.runId}`,
      `Conclusion: ${result.ciRepair.workflowRun.conclusion ?? "none"}`
    ].join("\n");
  }

  return [
    "Runstead CI repair orchestrator",
    `Status: ${result.status}`,
    `Task: ${result.ciRepair.task.id}`,
    `Branch: ${result.branchName}`,
    ...(result.workerResult === undefined
      ? []
      : [`Worker: ${result.workerResult.worker} exit=${result.workerResult.exitCode}`]),
    ...(result.workerResult !== undefined &&
    isCodexDirectWorkerResult(result.workerResult)
      ? [
          `Provider: ${result.workerResult.modelProvider}`,
          `Model: ${result.workerResult.model}`
        ]
      : []),
    ...(result.diffScope === undefined
      ? []
      : [`Diff scope: ${result.diffScope.passed ? "passed" : "failed"}`]),
    ...(result.verifierResult === undefined
      ? []
      : [`Verifier task: ${result.verifierResult.task.status}`]),
    result.pullRequest === undefined
      ? `Pull request: ${result.approval === undefined ? "not created" : `waiting approval ${result.approval.id}`}`
      : `Pull request: ${result.pullRequest.url ?? result.pullRequest.head}`
  ].join("\n");
}
