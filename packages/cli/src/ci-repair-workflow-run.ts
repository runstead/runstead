import type { GitHubWorkflowRunStatus } from "./github-actions.js";

const REPAIRABLE_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required"
]);

export class NonRepairableWorkflowRunError extends Error {}

export function repairableWorkflowRunIdFromWebhook(
  event: string,
  payload: unknown
): string | undefined {
  if (event !== "workflow_run" || !isRecord(payload)) {
    return undefined;
  }

  const action = payload.action;
  const workflowRun = payload.workflow_run;

  if (action !== "completed" || !isRecord(workflowRun)) {
    return undefined;
  }

  const status = workflowRun.status;
  const conclusion = workflowRun.conclusion;
  const id = workflowRun.id;

  if (
    status !== "completed" ||
    typeof conclusion !== "string" ||
    !REPAIRABLE_CONCLUSIONS.has(conclusion)
  ) {
    return undefined;
  }

  if (typeof id === "number" || typeof id === "string") {
    return String(id);
  }

  return undefined;
}

export function assertRepairableWorkflowRun(status: GitHubWorkflowRunStatus): void {
  if (status.status !== "completed") {
    throw new NonRepairableWorkflowRunError(
      `Workflow run ${status.runId} is ${status.status}, expected completed`
    );
  }

  if (
    status.conclusion === undefined ||
    !REPAIRABLE_CONCLUSIONS.has(status.conclusion)
  ) {
    throw new NonRepairableWorkflowRunError(
      `Workflow run ${status.runId} conclusion is ${status.conclusion ?? "none"}, expected repairable failure`
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
