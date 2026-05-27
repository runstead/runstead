import type {
  DashboardApproval,
  DashboardDaemonStatus,
  DashboardOperatorConsole,
  DashboardStartupSnapshot
} from "./dashboard-types.js";
import {
  dashboardApprovalApproveAndResumeCommand,
  dashboardOperatorRunContext
} from "./dashboard-operator-commands.js";
import { dashboardOperatorActions } from "./dashboard-operator-action-list.js";

export function buildDashboardOperatorConsole(input: {
  cwd: string;
  daemon: DashboardDaemonStatus;
  startup: DashboardStartupSnapshot;
  approvals: DashboardApproval[];
}): DashboardOperatorConsole {
  const actions = dashboardOperatorActions(input);
  const run = input.startup.latestRun;
  const recommendedAction =
    actions.find((action) => action.status === "blocked") ?? actions[0];
  const currentRun =
    run === undefined
      ? undefined
      : dashboardOperatorRunContext({
          cwd: input.cwd,
          run
        });
  const pendingApprovals = input.approvals
    .filter((item) => item.status === "pending")
    .map((approval) => ({
      id: approval.id,
      risk: approval.risk,
      reason: approval.reason,
      command: dashboardApprovalApproveAndResumeCommand(input.cwd, approval.id)
    }));
  const blockerCount =
    input.startup.status?.gates.reduce(
      (count, gate) => count + gate.blockers.length,
      0
    ) ??
    run?.blockers.length ??
    0;

  return {
    actions,
    ...(recommendedAction === undefined ? {} : { recommendedAction }),
    ...(currentRun === undefined ? {} : { currentRun }),
    pendingApprovals,
    blockerCount,
    staleEvidenceCount: input.startup.staleEvidence.length,
    ...(recommendedAction === undefined
      ? {}
      : { recommendedCommand: recommendedAction.command })
  };
}
