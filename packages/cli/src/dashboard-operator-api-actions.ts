import { createRunsteadId, type JsonObject, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { decideApproval } from "./approvals.js";
import { DashboardOperatorApiHttpError } from "./dashboard-operator-api-http.js";
import type { BuildDashboardResult } from "./dashboard-types.js";
import {
  approvalIdFromOperatorAction,
  shellOptionValue
} from "./dashboard-operator-action-command.js";
import {
  optionalStartupGateStage,
  requiredStringBodyField,
  stringArrayBodyField,
  stringBodyField
} from "./dashboard-operator-api-body.js";
import { checkPermission } from "./rbac.js";
import { resumeInterruptedTasks } from "./resume.js";
import { addStartupEvidence } from "./startup-evidence.js";
import { runStartupReady } from "./startup-ready.js";
import { runTaskVerifiers } from "./verifier-runner.js";

export interface DashboardOperatorApiAction {
  kind:
    | "operator_action"
    | "approval_approve"
    | "approval_deny"
    | "run_resume"
    | "verifiers_run"
    | "manual_evidence";
  id: string;
  path: string;
}

export type DashboardRebuild = (options: {
  cwd: string;
  outputDir: string;
}) => Promise<Pick<BuildDashboardResult, "event" | "htmlPath" | "dataPath">>;

export function dashboardOperatorMutationPath(pathname: string): boolean {
  return (
    /^\/operator-actions\/[^/]+\/run$/.test(pathname) ||
    /^\/approvals\/[^/]+\/(approve|deny)$/.test(pathname) ||
    /^\/runs\/[^/]+\/resume$/.test(pathname) ||
    pathname === "/verifiers/run" ||
    pathname === "/evidence/manual"
  );
}

export function dashboardOperatorActionDescriptor(
  pathname: string,
  body: Record<string, unknown>
): DashboardOperatorApiAction {
  const parts = pathname.split("/").map((part) => decodeURIComponent(part));

  if (parts[1] === "operator-actions" && parts[3] === "run") {
    return {
      kind: "operator_action",
      id: parts[2] ?? "unknown",
      path: pathname
    };
  }

  if (parts[1] === "approvals" && parts[3] === "approve") {
    return {
      kind: "approval_approve",
      id: parts[2] ?? "unknown",
      path: pathname
    };
  }

  if (parts[1] === "approvals" && parts[3] === "deny") {
    return {
      kind: "approval_deny",
      id: parts[2] ?? "unknown",
      path: pathname
    };
  }

  if (parts[1] === "runs" && parts[3] === "resume") {
    return {
      kind: "run_resume",
      id: parts[2] ?? "unknown",
      path: pathname
    };
  }

  if (pathname === "/verifiers/run") {
    return {
      kind: "verifiers_run",
      id: stringBodyField(body.taskId) ?? "unknown",
      path: pathname
    };
  }

  return {
    kind: "manual_evidence",
    id: stringBodyField(body.type) ?? "manual_change",
    path: pathname
  };
}

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

export function recordDashboardOperatorApiEvent(input: {
  build: BuildDashboardResult;
  actor: string;
  action: DashboardOperatorApiAction;
  status: "completed" | "failed";
  result?: JsonObject;
  error?: string;
}): void {
  const createdAt = new Date().toISOString();
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: `dashboard.operator_action.${input.status}`,
    aggregateType: "dashboard_operator_action",
    aggregateId: input.action.id,
    payload: {
      actor: input.actor,
      action: input.action,
      status: input.status,
      ...(input.result === undefined ? {} : { result: input.result }),
      ...(input.error === undefined ? {} : { error: input.error })
    },
    createdAt
  };
  const database = openRunsteadDatabase(input.build.stateDb);

  try {
    appendEventAndProject(database, { event });
  } finally {
    database.close();
  }
}

async function approveDashboardApproval(input: {
  cwd: string;
  actor: string;
  approvalId: string;
}): Promise<JsonObject> {
  const result = await decideApproval({
    cwd: input.cwd,
    id: input.approvalId,
    decision: "approved",
    decidedBy: input.actor
  });

  return {
    approvalId: result.approval.id,
    status: result.approval.status,
    previousStatus: result.previousStatus,
    eventId: result.event.eventId
  };
}

async function denyDashboardApproval(input: {
  cwd: string;
  actor: string;
  approvalId: string;
}): Promise<JsonObject> {
  const result = await decideApproval({
    cwd: input.cwd,
    id: input.approvalId,
    decision: "denied",
    decidedBy: input.actor
  });

  return {
    approvalId: result.approval.id,
    status: result.approval.status,
    previousStatus: result.previousStatus,
    eventId: result.event.eventId
  };
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

async function runDashboardVerifiers(input: {
  cwd: string;
  actor: string;
  body: Record<string, unknown>;
}): Promise<JsonObject> {
  await requireDashboardOperatorPermission({
    cwd: input.cwd,
    actor: input.actor,
    permission: "task.run",
    action: "run verifiers"
  });

  const taskId = requiredStringBodyField(input.body.taskId, "taskId");
  const mode = stringBodyField(input.body.mode);
  const result = await runTaskVerifiers({
    cwd: input.cwd,
    taskId,
    mode: mode === "finalize_task" ? "finalize_task" : "evidence_only"
  });

  return {
    taskId: result.task.id,
    taskStatus: result.task.status,
    verifierCount: result.commandResults.length,
    evidenceIds: result.commandResults
      .map((item) => item.evidenceId)
      .filter((id): id is string => id !== undefined)
  };
}

async function recordDashboardManualEvidence(input: {
  cwd: string;
  actor: string;
  body: Record<string, unknown>;
}): Promise<JsonObject> {
  await requireDashboardOperatorPermission({
    cwd: input.cwd,
    actor: input.actor,
    permission: "evidence.write",
    action: "record manual evidence"
  });

  const type = stringBodyField(input.body.type) ?? "manual_change";
  const summary = requiredStringBodyField(input.body.summary, "summary");
  const gate = optionalStartupGateStage(input.body.gate);
  const result = await addStartupEvidence({
    cwd: input.cwd,
    type,
    summary,
    sourceRefs: stringArrayBodyField(input.body.sourceRefs),
    ...(stringBodyField(input.body.content) === undefined
      ? {}
      : { content: stringBodyField(input.body.content) ?? "" }),
    ...(stringBodyField(input.body.goalId) === undefined
      ? {}
      : { goalId: stringBodyField(input.body.goalId) ?? "" }),
    ...(gate === undefined ? {} : { gate }),
    ...(stringBodyField(input.body.blocker) === undefined
      ? {}
      : { blocker: stringBodyField(input.body.blocker) ?? "" })
  });

  return {
    evidenceId: result.evidence.id,
    evidenceType: result.evidence.type,
    artifactPath: result.artifactPath
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

async function requireDashboardOperatorPermission(input: {
  cwd: string;
  actor: string;
  permission: string;
  action: string;
}): Promise<void> {
  const permission = await checkPermission({
    cwd: input.cwd,
    subject: input.actor,
    permission: input.permission
  });

  if (permission.decision !== "allow") {
    throw new DashboardOperatorApiHttpError(
      403,
      "rbac_denied",
      `Subject ${input.actor} cannot ${input.action}: ${permission.reason}`
    );
  }
}
