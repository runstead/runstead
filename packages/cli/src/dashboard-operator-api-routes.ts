import { stringBodyField } from "./dashboard-operator-api-body.js";

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
