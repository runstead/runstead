import type { ToolActionApprovalRequiredError } from "./governed-action.js";

export function ciRepairApprovalSummary(error: ToolActionApprovalRequiredError) {
  return {
    id: error.approval.id,
    actionId: error.approval.actionId,
    policyDecisionId: error.approval.policyDecisionId,
    reason: error.approval.reason
  };
}

export function ciRepairApprovalRecord(error: ToolActionApprovalRequiredError) {
  return {
    ...ciRepairApprovalSummary(error),
    status: error.approval.status
  };
}

export function ciRepairPublishApprovalStage(
  actionType: string
): "publish_approval_requested" | "push_approval_requested" | "pr_approval_requested" {
  if (actionType === "repo.publish_repair") {
    return "publish_approval_requested";
  }

  if (actionType === "git.push") {
    return "push_approval_requested";
  }

  return "pr_approval_requested";
}
