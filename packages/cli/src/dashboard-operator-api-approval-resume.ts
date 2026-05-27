import type { JsonObject } from "@runstead/core";

import { approvalIdFromOperatorAction } from "./dashboard-operator-action-command.js";
import { approveDashboardApproval } from "./dashboard-operator-api-approvals.js";
import type { DashboardOperatorAction, DashboardSnapshot } from "./dashboard-types.js";
import { resumeInterruptedTasks } from "./resume.js";

export function dashboardApprovalResumeOperatorApprovalId(
  action: DashboardOperatorAction,
  snapshot: DashboardSnapshot
): string | undefined {
  return approvalIdFromOperatorAction(action, snapshot);
}

export async function runDashboardApprovalResumeOperatorAction(input: {
  cwd: string;
  actor: string;
  actionId: string;
  approvalId: string;
}): Promise<JsonObject> {
  const approval = await approveDashboardApproval({
    cwd: input.cwd,
    actor: input.actor,
    approvalId: input.approvalId
  });
  const resumed = await resumeInterruptedTasks({
    cwd: input.cwd
  });

  return {
    operatorActionId: input.actionId,
    approval,
    requeuedTaskIds: resumed.requeuedTasks.map((item) => item.task.id),
    failedTaskIds: resumed.failedTasks.map((item) => item.task.id)
  };
}
