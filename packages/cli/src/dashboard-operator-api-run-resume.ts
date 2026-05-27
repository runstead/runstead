import type { JsonObject } from "@runstead/core";

import { shellOptionValue } from "./dashboard-operator-action-command.js";
import { requireDashboardOperatorPermission } from "./dashboard-operator-api-permissions.js";
import { runStartupReady } from "./startup-ready.js";

export function dashboardStartupRunResumeOperatorRunId(
  command: string
): string | undefined {
  return shellOptionValue(command, "--resume");
}

export async function runDashboardStartupRunResumeOperatorAction(input: {
  cwd: string;
  actor: string;
  actionId: string;
  runId: string;
}): Promise<JsonObject> {
  const resumed = await resumeDashboardStartupRun({
    cwd: input.cwd,
    actor: input.actor,
    runId: input.runId
  });

  return {
    operatorActionId: input.actionId,
    resumed
  };
}

export async function resumeDashboardStartupRun(input: {
  cwd: string;
  actor: string;
  runId: string;
}): Promise<JsonObject> {
  await requireDashboardOperatorPermission({
    cwd: input.cwd,
    actor: input.actor,
    permission: "task.run",
    action: "resume startup readiness"
  });

  const result = await runStartupReady({
    cwd: input.cwd,
    resumeRunId: input.runId
  });

  return {
    runId: result.run.id,
    status: result.run.status,
    verdict: result.run.verdict
  };
}
