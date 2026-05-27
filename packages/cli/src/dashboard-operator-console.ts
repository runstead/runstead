import type {
  DashboardApproval,
  DashboardDaemonStatus,
  DashboardOperatorConsole,
  DashboardStartupSnapshot
} from "./dashboard-types.js";
import { dashboardOperatorRunContext } from "./dashboard-operator-commands.js";
import { dashboardOperatorActions } from "./dashboard-operator-action-list.js";
import {
  dashboardOperatorBlockerCount,
  dashboardPendingApprovals
} from "./dashboard-operator-summary.js";

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
  const pendingApprovals = dashboardPendingApprovals(input);
  const blockerCount = dashboardOperatorBlockerCount(input.startup);

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
