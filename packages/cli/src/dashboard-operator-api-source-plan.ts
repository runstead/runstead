import type { JsonObject } from "@runstead/core";

import { shellOptionValue } from "./dashboard-operator-action-command.js";
import { DashboardOperatorApiHttpError } from "./dashboard-operator-api-http.js";
import { requireDashboardOperatorPermission } from "./dashboard-operator-api-permissions.js";
import { createStartupSourceRefreshPlan } from "./startup-source-refresh-plan.js";

export function dashboardSourcePlanOperatorCommand(command: string): boolean {
  return /\brunstead\s+startup\s+source\s+plan\b/.test(command);
}

export async function runDashboardSourcePlanOperatorAction(input: {
  cwd: string;
  actor: string;
  actionId: string;
  command: string;
}): Promise<JsonObject> {
  await requireDashboardOperatorPermission({
    cwd: input.cwd,
    actor: input.actor,
    permission: "dashboard.manage",
    action: "plan startup source refresh"
  });

  const target = shellOptionValue(input.command, "--target");

  if (target === undefined) {
    throw new DashboardOperatorApiHttpError(
      422,
      "invalid_operator_action",
      `Operator action ${input.actionId} is missing --target.`
    );
  }

  const plan = createStartupSourceRefreshPlan({ target });

  return {
    operatorActionId: input.actionId,
    target: plan.target,
    blockers: plan.blockers,
    requirements: plan.requirements
  };
}
