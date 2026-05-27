import type { DashboardApproval, DashboardStartupSnapshot } from "./dashboard-types.js";
import { dashboardApprovalApproveAndResumeCommand } from "./dashboard-operator-commands.js";

export function dashboardPendingApprovals(input: {
  cwd: string;
  approvals: DashboardApproval[];
}): {
  id: string;
  risk: string;
  reason: string;
  command: string;
}[] {
  return input.approvals
    .filter((item) => item.status === "pending")
    .map((approval) => ({
      id: approval.id,
      risk: approval.risk,
      reason: approval.reason,
      command: dashboardApprovalApproveAndResumeCommand(input.cwd, approval.id)
    }));
}

export function dashboardOperatorBlockerCount(
  startup: DashboardStartupSnapshot
): number {
  return (
    startup.status?.gates.reduce((count, gate) => count + gate.blockers.length, 0) ??
    startup.latestRun?.blockers.length ??
    0
  );
}
