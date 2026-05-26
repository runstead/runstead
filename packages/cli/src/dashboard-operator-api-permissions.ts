import { DashboardOperatorApiHttpError } from "./dashboard-operator-api-http.js";
import { checkPermission } from "./rbac.js";

export async function requireDashboardOperatorPermission(input: {
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
