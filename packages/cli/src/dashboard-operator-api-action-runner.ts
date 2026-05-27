import type { JsonObject } from "@runstead/core";

import { approveDashboardApproval } from "./dashboard-operator-api-approvals.js";
import { DashboardOperatorApiHttpError } from "./dashboard-operator-api-http.js";
import { requireDashboardOperatorPermission } from "./dashboard-operator-api-permissions.js";
import type { BuildDashboardResult } from "./dashboard-types.js";
import {
  approvalIdFromOperatorAction,
  shellOptionValue
} from "./dashboard-operator-action-command.js";
import { resumeInterruptedTasks } from "./resume.js";
import { resumeDashboardStartupRun } from "./dashboard-operator-api-run-resume.js";
import {
  dashboardSourcePlanOperatorCommand,
  runDashboardSourcePlanOperatorAction
} from "./dashboard-operator-api-source-plan.js";

export type DashboardOperatorApiRebuild = (options: {
  cwd: string;
  outputDir: string;
}) => Promise<Pick<BuildDashboardResult, "event" | "htmlPath" | "dataPath">>;

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

  const approvalId = approvalIdFromOperatorAction(action, input.build.snapshot);

  if (approvalId !== undefined) {
    const approval = await approveDashboardApproval({
      cwd: input.build.cwd,
      actor: input.actor,
      approvalId
    });
    const resumed = await resumeInterruptedTasks({
      cwd: input.build.cwd
    });

    return {
      operatorActionId: action.id,
      approval,
      requeuedTaskIds: resumed.requeuedTasks.map((item) => item.task.id),
      failedTaskIds: resumed.failedTasks.map((item) => item.task.id)
    };
  }

  const runId = shellOptionValue(action.command, "--resume");

  if (runId !== undefined) {
    const resumed = await resumeDashboardStartupRun({
      cwd: input.build.cwd,
      actor: input.actor,
      runId
    });

    return {
      operatorActionId: action.id,
      resumed
    };
  }

  if (dashboardSourcePlanOperatorCommand(action.command)) {
    return runDashboardSourcePlanOperatorAction({
      cwd: input.build.cwd,
      actor: input.actor,
      actionId: action.id,
      command: action.command
    });
  }

  if (/\brunstead\s+dashboard\s+build\b/.test(action.command)) {
    await requireDashboardOperatorPermission({
      cwd: input.build.cwd,
      actor: input.actor,
      permission: "dashboard.manage",
      action: "rebuild dashboard"
    });

    const rebuilt = await input.rebuildDashboard({
      cwd: input.build.cwd,
      outputDir: input.build.outputDir
    });

    return {
      operatorActionId: action.id,
      dashboardEventId: rebuilt.event.eventId,
      htmlPath: rebuilt.htmlPath,
      dataPath: rebuilt.dataPath
    };
  }

  throw new DashboardOperatorApiHttpError(
    422,
    "unsupported_operator_action",
    `Operator action ${action.id} is not executable by the local API.`
  );
}
