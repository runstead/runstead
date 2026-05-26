import type {
  ExecuteStartupRemediationPlanResult,
  GenerateStartupRemediationPlanResult
} from "./startup-remediation.js";

export function formatStartupRemediationPlan(
  result: GenerateStartupRemediationPlanResult
): string {
  return [
    `Startup remediation: ${result.stage}`,
    `Domain: ${result.domain}`,
    `Status: ${result.status}`,
    ...(result.reportPath === undefined ? [] : [`Report: ${result.reportPath}`]),
    "",
    "Blockers:",
    listOrNone(result.blockers, (blocker) => `- ${blocker}`),
    "",
    "Tasks:",
    listOrNone(
      result.tasks,
      (item) =>
        `- ${item.task.id} ${item.reused ? "(reused)" : "(created)"} [${item.severity}]: ${item.blocker}`
    ),
    "",
    "Dependencies:",
    listOrNone(
      result.plan.edges,
      (edge) => `- ${edge.fromTaskId} -> ${edge.toTaskId}: ${edge.reason}`
    ),
    "",
    "Next commands:",
    listOrNone(result.nextCommands, (command) => `- ${command}`)
  ].join("\n");
}

export function formatStartupRemediationExecution(
  result: ExecuteStartupRemediationPlanResult
): string {
  return [
    formatStartupRemediationPlan(result),
    "",
    "Execution:",
    `- Worker: ${result.worker}`,
    `- Outcome: ${result.executionOutcome}`,
    `- Budget: selected=${result.budget.selectedTasks} skipped=${result.budget.skippedTasks}`,
    listOrNone(
      result.executed,
      (item) =>
        `- ${item.remediationTaskId} -> ${item.localAgentTaskId}: ${item.status}; resolved=${item.resolved ? "yes" : "no"}; remaining=${item.remainingBlockers.length}${item.failureEvidenceId === undefined ? "" : `; failureEvidence=${item.failureEvidenceId}`}`
    ),
    "",
    "Final gate:",
    `- Status: ${result.finalGate.passed ? "passed" : "blocked"}`,
    `- Event: ${result.finalGate.eventId}`,
    listOrNone(result.finalGate.blockers, (blocker) => `- blocker: ${blocker}`),
    ...(result.finalReportPath === undefined
      ? []
      : ["", `Final report: ${result.finalReportPath}`])
  ].join("\n");
}

function listOrNone<T>(items: T[], formatter: (item: T) => string): string {
  if (items.length === 0) {
    return "- none";
  }

  return items.map(formatter).join("\n");
}
