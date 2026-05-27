import type { JsonObject } from "@runstead/core";

import {
  approveDashboardApproval,
  denyDashboardApproval
} from "./dashboard-operator-api-approvals.js";
import { DashboardOperatorApiHttpError } from "./dashboard-operator-api-http.js";
import { requireDashboardOperatorPermission } from "./dashboard-operator-api-permissions.js";
import type { BuildDashboardResult } from "./dashboard-types.js";
import {
  approvalIdFromOperatorAction,
  shellOptionValue
} from "./dashboard-operator-action-command.js";
import {
  recordDashboardManualEvidence,
  runDashboardVerifiers
} from "./dashboard-operator-api-forms.js";
import type { DashboardOperatorApiAction } from "./dashboard-operator-api-routes.js";
import { resumeInterruptedTasks } from "./resume.js";
import { runStartupReady } from "./startup-ready.js";

export {
  dashboardOperatorActionDescriptor,
  dashboardOperatorMutationPath
} from "./dashboard-operator-api-routes.js";
export { recordDashboardOperatorApiEvent } from "./dashboard-operator-api-events.js";
export type { DashboardOperatorApiAction } from "./dashboard-operator-api-routes.js";

export type DashboardRebuild = (options: {
  cwd: string;
  outputDir: string;
}) => Promise<Pick<BuildDashboardResult, "event" | "htmlPath" | "dataPath">>;

export async function executeDashboardOperatorApiAction(input: {
  build: BuildDashboardResult;
  actor: string;
  action: DashboardOperatorApiAction;
  body: Record<string, unknown>;
  rebuildDashboard: DashboardRebuild;
}): Promise<JsonObject> {
  if (input.action.kind === "approval_approve") {
    return approveDashboardApproval({
      cwd: input.build.cwd,
      actor: input.actor,
      approvalId: input.action.id
    });
  }

  if (input.action.kind === "approval_deny") {
    return denyDashboardApproval({
      cwd: input.build.cwd,
      actor: input.actor,
      approvalId: input.action.id
    });
  }

  if (input.action.kind === "run_resume") {
    return resumeDashboardStartupRun({
      cwd: input.build.cwd,
      actor: input.actor,
      runId: input.action.id
    });
  }

  if (input.action.kind === "verifiers_run") {
    return runDashboardVerifiers({
      cwd: input.build.cwd,
      actor: input.actor,
      body: input.body
    });
  }

  if (input.action.kind === "manual_evidence") {
    return recordDashboardManualEvidence({
      cwd: input.build.cwd,
      actor: input.actor,
      body: input.body
    });
  }

  return runDashboardOperatorAction({
    build: input.build,
    actor: input.actor,
    actionId: input.action.id,
    rebuildDashboard: input.rebuildDashboard
  });
}

async function resumeDashboardStartupRun(input: {
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

async function runDashboardOperatorAction(input: {
  build: BuildDashboardResult;
  actor: string;
  actionId: string;
  rebuildDashboard: DashboardRebuild;
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
