import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { dashboardOperatorMutationPath } from "./dashboard-operator-api-actions.js";
import { localBindHost } from "./dashboard-operator-api-auth.js";
import { serveDashboardOperatorApiRequest } from "./dashboard-operator-api-server.js";
import { serveDashboardStaticRequest } from "./dashboard-static-server.js";
import type {
  BuildDashboardResult,
  DashboardOperatorApiConfig,
  ServeDashboardOptions
} from "./dashboard-types.js";

export type DashboardRebuild = (
  options: ServeDashboardOptions
) => Promise<BuildDashboardResult>;

export function dashboardOperatorApiConfig(
  options: ServeDashboardOptions,
  host: string
): DashboardOperatorApiConfig {
  if (options.enableOperatorApi !== true) {
    return { enabled: false };
  }

  if (!localBindHost(host)) {
    throw new Error(
      "Operator API is local-only. Use --host 127.0.0.1 or --host ::1 when --enable-operator-api is set."
    );
  }

  return {
    enabled: true,
    sessionToken: options.sessionToken ?? randomBytes(24).toString("hex"),
    csrfToken: options.csrfToken ?? randomBytes(24).toString("hex"),
    actor: options.actor ?? "local-admin"
  };
}

export async function serveDashboardRequest(input: {
  build: BuildDashboardResult;
  host: string;
  operatorApi: DashboardOperatorApiConfig;
  request: IncomingMessage;
  response: ServerResponse;
  rebuildDashboard: DashboardRebuild;
}): Promise<void> {
  const requestUrl = new URL(input.request.url ?? "/", `http://${input.host}`);
  const pathname = requestUrl.pathname;

  if (dashboardOperatorMutationPath(pathname)) {
    await serveDashboardOperatorApiRequest({
      build: input.build,
      operatorApi: input.operatorApi,
      request: input.request,
      response: input.response,
      pathname,
      rebuildDashboard: input.rebuildDashboard
    });
    return;
  }

  await serveDashboardStaticRequest({
    build: input.build,
    pathname,
    request: input.request,
    response: input.response
  });
}
