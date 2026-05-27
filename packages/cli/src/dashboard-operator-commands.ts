import type {
  DashboardOperatorRunContext,
  DashboardStartupRun
} from "./dashboard-types.js";

export function dashboardApprovalApproveAndResumeCommand(
  cwd: string,
  approvalId: string
): string {
  return `runstead approval approve-and-resume ${shellQuoteCommandArg(approvalId)} --cwd ${shellQuoteCommandArg(cwd)}`;
}

export function dashboardStartupResumeCommand(cwd: string, runId: string): string {
  return `runstead startup ready --cwd ${shellQuoteCommandArg(cwd)} --resume ${shellQuoteCommandArg(runId)}`;
}

export function dashboardOperatorRunContext(input: {
  cwd: string;
  run: DashboardStartupRun;
}): DashboardOperatorRunContext {
  const resumeCommand = input.run.operatorCommands.find(
    (command) => command.kind === "resume"
  )?.command;

  return {
    id: input.run.id,
    stage: input.run.stage,
    target: input.run.target,
    status: input.run.status,
    verdict: input.run.verdict,
    blockers: input.run.blockers,
    resumeCommand:
      resumeCommand ?? dashboardStartupResumeCommand(input.cwd, input.run.id)
  };
}

export function shellQuoteCommandArg(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}
