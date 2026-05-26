import type { JsonObject } from "@runstead/core";

import { decideApproval } from "./approvals.js";

export async function approveDashboardApproval(input: {
  cwd: string;
  actor: string;
  approvalId: string;
}): Promise<JsonObject> {
  const result = await decideApproval({
    cwd: input.cwd,
    id: input.approvalId,
    decision: "approved",
    decidedBy: input.actor
  });

  return {
    approvalId: result.approval.id,
    status: result.approval.status,
    previousStatus: result.previousStatus,
    eventId: result.event.eventId
  };
}

export async function denyDashboardApproval(input: {
  cwd: string;
  actor: string;
  approvalId: string;
}): Promise<JsonObject> {
  const result = await decideApproval({
    cwd: input.cwd,
    id: input.approvalId,
    decision: "denied",
    decidedBy: input.actor
  });

  return {
    approvalId: result.approval.id,
    status: result.approval.status,
    previousStatus: result.previousStatus,
    eventId: result.event.eventId
  };
}
