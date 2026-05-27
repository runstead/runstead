import type { JsonObject } from "@runstead/core";

import { shellOptionValue } from "./dashboard-operator-action-command.js";
import { requireDashboardOperatorPermission } from "./dashboard-operator-api-permissions.js";
import { generateStartupCompleteProductCheck } from "./startup-complete-check.js";
import { parseStartupReadyTarget } from "./startup-ready/options.js";

export function dashboardCompleteCheckOperatorCommand(command: string): boolean {
  return /\brunstead\s+startup\s+complete-check\b/.test(command);
}

export async function runDashboardCompleteCheckOperatorAction(input: {
  cwd: string;
  actor: string;
  actionId: string;
  command: string;
}): Promise<JsonObject> {
  await requireDashboardOperatorPermission({
    cwd: input.cwd,
    actor: input.actor,
    permission: "evidence.write",
    action: "write startup complete product audit evidence"
  });
  await requireDashboardOperatorPermission({
    cwd: input.cwd,
    actor: input.actor,
    permission: "audit.read",
    action: "read startup complete product audit inputs"
  });
  await requireDashboardOperatorPermission({
    cwd: input.cwd,
    actor: input.actor,
    permission: "dashboard.manage",
    action: "build startup complete product dashboard surface"
  });
  await requireDashboardOperatorPermission({
    cwd: input.cwd,
    actor: input.actor,
    permission: "task.run",
    action: "plan startup complete product remediation"
  });

  const result = await generateStartupCompleteProductCheck({
    cwd: input.cwd,
    domain: shellOptionValue(input.command, "--domain") ?? "ai-native-startup",
    target: parseStartupReadyTarget(
      shellOptionValue(input.command, "--target") ?? "local"
    )
  });

  return {
    operatorActionId: input.actionId,
    status: result.status,
    score: result.score,
    evidenceId: result.evidenceId,
    eventId: result.event.eventId,
    markdownPath: result.markdownPath,
    jsonPath: result.jsonPath,
    blockers: result.blockers.map((blocker) => blocker.blocker)
  };
}
