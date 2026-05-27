import type { JsonObject } from "@runstead/core";

import { requireDashboardOperatorPermission } from "./dashboard-operator-api-permissions.js";
import type { BuildDashboardResult } from "./dashboard-types.js";

export type DashboardOperatorApiRebuild = (options: {
  cwd: string;
  outputDir: string;
}) => Promise<Pick<BuildDashboardResult, "event" | "htmlPath" | "dataPath">>;

export function dashboardBuildOperatorCommand(command: string): boolean {
  return /\brunstead\s+dashboard\s+build\b/.test(command);
}

export async function runDashboardBuildOperatorAction(input: {
  cwd: string;
  outputDir: string;
  actor: string;
  actionId: string;
  rebuildDashboard: DashboardOperatorApiRebuild;
}): Promise<JsonObject> {
  await requireDashboardOperatorPermission({
    cwd: input.cwd,
    actor: input.actor,
    permission: "dashboard.manage",
    action: "rebuild dashboard"
  });

  const rebuilt = await input.rebuildDashboard({
    cwd: input.cwd,
    outputDir: input.outputDir
  });

  return {
    operatorActionId: input.actionId,
    dashboardEventId: rebuilt.event.eventId,
    htmlPath: rebuilt.htmlPath,
    dataPath: rebuilt.dataPath
  };
}
