import type { JsonObject } from "@runstead/core";

import { requireDashboardOperatorPermission } from "./dashboard-operator-api-permissions.js";
import { runStartupReady } from "./startup-ready.js";

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
