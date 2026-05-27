import type { JsonObject } from "@runstead/core";

import { DashboardOperatorApiHttpError } from "./dashboard-operator-api-http.js";
import type { BuildDashboardResult } from "./dashboard-types.js";
import {
  dashboardStartupRunResumeOperatorRunId,
  runDashboardStartupRunResumeOperatorAction
} from "./dashboard-operator-api-run-resume.js";
import {
  dashboardApprovalResumeOperatorApprovalId,
  runDashboardApprovalResumeOperatorAction
} from "./dashboard-operator-api-approval-resume.js";
import {
  dashboardBuildOperatorCommand,
  runDashboardBuildOperatorAction,
  type DashboardOperatorApiRebuild
} from "./dashboard-operator-api-dashboard-build.js";
import {
  dashboardCompleteCheckOperatorCommand,
  runDashboardCompleteCheckOperatorAction
} from "./dashboard-operator-api-complete-check.js";
import {
  dashboardSourcePlanOperatorCommand,
  runDashboardSourcePlanOperatorAction
} from "./dashboard-operator-api-source-plan.js";

export type { DashboardOperatorApiRebuild };

export async function runDashboardOperatorAction(input: {
  build: BuildDashboardResult;
  actor: string;
  actionId: string;
  rebuildDashboard: DashboardOperatorApiRebuild;
}): Promise<JsonObject> {
  const action = input.build.snapshot.operator.actions.find(
    (item) => item.id === input.actionId
  );

  if (action === undefined) {
    throw new DashboardOperatorApiHttpError(
      404,
      "operator_action_not_found",
      `Operator action not found: ${input.actionId}`
    );
  }

  const approvalId = dashboardApprovalResumeOperatorApprovalId(
    action,
    input.build.snapshot
  );

  if (approvalId !== undefined) {
    return runDashboardApprovalResumeOperatorAction({
      cwd: input.build.cwd,
      actor: input.actor,
      actionId: action.id,
      approvalId
    });
  }

  const runId = dashboardStartupRunResumeOperatorRunId(action.command);

  if (runId !== undefined) {
    return runDashboardStartupRunResumeOperatorAction({
      cwd: input.build.cwd,
      actor: input.actor,
      actionId: action.id,
      runId
    });
  }

  if (dashboardCompleteCheckOperatorCommand(action.command)) {
    return runDashboardCompleteCheckOperatorAction({
      cwd: input.build.cwd,
      actor: input.actor,
      actionId: action.id,
      command: action.command
    });
  }

  if (dashboardSourcePlanOperatorCommand(action.command)) {
    return runDashboardSourcePlanOperatorAction({
      cwd: input.build.cwd,
      actor: input.actor,
      actionId: action.id,
      command: action.command
    });
  }

  if (dashboardBuildOperatorCommand(action.command)) {
    return runDashboardBuildOperatorAction({
      cwd: input.build.cwd,
      actor: input.actor,
      outputDir: input.build.outputDir,
      actionId: action.id,
      rebuildDashboard: input.rebuildDashboard
    });
  }

  throw new DashboardOperatorApiHttpError(
    422,
    "unsupported_operator_action",
    `Operator action ${action.id} is not executable by the local API.`
  );
}
