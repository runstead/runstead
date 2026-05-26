import type { DashboardOperatorAction, DashboardSnapshot } from "./dashboard-types.js";

export function approvalIdFromOperatorAction(
  action: DashboardOperatorAction,
  snapshot: DashboardSnapshot
): string | undefined {
  if (action.id.startsWith("approval-")) {
    return action.id.slice("approval-".length);
  }

  if (action.id === "daemon-approval-resume") {
    return snapshot.daemon.approvalId ?? approvalIdFromCommand(action.command);
  }

  return approvalIdFromCommand(action.command);
}

export function shellOptionValue(command: string, option: string): string | undefined {
  const escaped = option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s+("[^"]+"|'[^']+'|\\S+)`).exec(command);

  return match?.[1] === undefined ? undefined : unquoteShellToken(match[1]);
}

function approvalIdFromCommand(command: string): string | undefined {
  const match = /\bapproval\s+approve-and-resume\s+("[^"]+"|'[^']+'|\S+)/.exec(command);

  return match?.[1] === undefined ? undefined : unquoteShellToken(match[1]);
}

function unquoteShellToken(value: string): string {
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
