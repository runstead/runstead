import type { JsonObject } from "@runstead/core";

import {
  approveDashboardApproval,
  denyDashboardApproval
} from "./dashboard-operator-api-approvals.js";
import type { BuildDashboardResult } from "./dashboard-types.js";
import {
  runDashboardOperatorAction,
  type DashboardOperatorApiRebuild
} from "./dashboard-operator-api-action-runner.js";
import {
  recordDashboardManualEvidence,
  runDashboardVerifiers
} from "./dashboard-operator-api-forms.js";
import type { DashboardOperatorApiAction } from "./dashboard-operator-api-routes.js";
import { resumeDashboardStartupRun } from "./dashboard-operator-api-run-resume.js";

export {
  dashboardOperatorActionDescriptor,
  dashboardOperatorMutationPath
} from "./dashboard-operator-api-routes.js";
export { recordDashboardOperatorApiEvent } from "./dashboard-operator-api-events.js";
export type { DashboardOperatorApiAction } from "./dashboard-operator-api-routes.js";

export type DashboardRebuild = DashboardOperatorApiRebuild;

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
