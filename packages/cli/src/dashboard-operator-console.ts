import type {
  DashboardApproval,
  DashboardDaemonStatus,
  DashboardOperatorAction,
  DashboardOperatorConsole,
  DashboardStartupSnapshot
} from "./dashboard-types.js";
import {
  dashboardApprovalApproveAndResumeCommand,
  dashboardOperatorRunContext
} from "./dashboard-operator-commands.js";

export function buildDashboardOperatorConsole(input: {
  cwd: string;
  daemon: DashboardDaemonStatus;
  startup: DashboardStartupSnapshot;
  approvals: DashboardApproval[];
}): DashboardOperatorConsole {
  const actions: DashboardOperatorAction[] = [];
  const seen = new Set<string>();
  const addAction = (action: DashboardOperatorAction): void => {
    const key = `${action.source}:${action.command}`;

    if (action.command.trim().length === 0 || seen.has(key)) {
      return;
    }

    seen.add(key);
    actions.push(action);
  };

  if (input.daemon.approvalId !== undefined) {
    addAction({
      id: "daemon-approval-resume",
      title: "Approve and resume daemon task",
      command: dashboardApprovalApproveAndResumeCommand(
        input.cwd,
        input.daemon.approvalId
      ),
      reason:
        input.daemon.ciRepairStatus === undefined
          ? "A daemon task is waiting on approval."
          : `Daemon CI repair is ${input.daemon.ciRepairStatus}.`,
      source: "daemon_approval",
      status: "blocked"
    });
  }

  for (const approval of input.approvals.filter((item) => item.status === "pending")) {
    addAction({
      id: `approval-${approval.id}`,
      title: `Approve ${approval.risk}-risk request`,
      command: dashboardApprovalApproveAndResumeCommand(input.cwd, approval.id),
      reason: approval.reason,
      source: "daemon_approval",
      status: "blocked"
    });
  }

  if (input.startup.status !== undefined) {
    const activeBlockers =
      input.startup.status.readiness?.blockers ??
      input.startup.status.gates.flatMap((gate) => gate.blockers);

    addAction({
      id: "startup-next-action",
      title: "Run startup next action",
      command: input.startup.status.nextAction.command,
      reason: input.startup.status.nextAction.reason,
      source: "startup_next_action",
      status: activeBlockers.length === 0 ? "ready" : "blocked"
    });
  }

  const run = input.startup.latestRun;

  for (const [index, item] of (run?.operatorCommands ?? []).entries()) {
    addAction({
      id: `startup-run-command-${index + 1}`,
      title: item.title,
      command: item.command,
      reason: item.when,
      source: "startup_run_command",
      status:
        item.kind === "recover"
          ? "ready"
          : item.kind === "resume" && run?.status !== "completed"
            ? "blocked"
            : "info"
    });
  }

  for (const [index, step] of (run?.guidedFlow ?? []).entries()) {
    if (step.command === undefined) {
      continue;
    }

    addAction({
      id: `guided-flow-${index + 1}`,
      title: step.title,
      command: step.command,
      reason: step.why,
      source: "guided_flow",
      status: step.status === "blocked" ? "blocked" : "ready"
    });
  }

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
