import { createServer } from "node:http";

import { buildDashboard } from "./dashboard-build.js";
import { listen, serverPort, urlHost } from "./dashboard-operator-api-http.js";
import {
  dashboardOperatorApiConfig,
  serveDashboardRequest
} from "./dashboard-server.js";
import type { ServeDashboardOptions, ServeDashboardResult } from "./dashboard-types.js";

export type {
  BuildDashboardOptions,
  BuildDashboardResult,
  DashboardApproval,
  DashboardDaemonStatus,
  DashboardEvent,
  DashboardGoal,
  DashboardOperatorAction,
  DashboardOperatorApiSession,
  DashboardOperatorConsole,
  DashboardOperatorPendingApproval,
  DashboardOperatorRunContext,
  DashboardRepository,
  DashboardSnapshot,
  DashboardStartupAgentPatch,
  DashboardStartupGuidedStep,
  DashboardStartupOperatorCommand,
  DashboardStartupResolvedBlocker,
  DashboardStartupRun,
  DashboardStartupRunComparison,
  DashboardStartupRunPhaseSummary,
  DashboardStartupRunSummary,
  DashboardStartupSnapshot,
  DashboardStartupStaleEvidence,
  DashboardStartupTimelineEntry,
  DashboardStartupTimelineGroup,
  DashboardStartupTimelineItem,
  DashboardSummary,
  DashboardTask,
  ServeDashboardOptions,
  ServeDashboardResult
} from "./dashboard-types.js";
export { buildDashboard } from "./dashboard-build.js";

export async function serveDashboard(
  options: ServeDashboardOptions = {}
): Promise<ServeDashboardResult> {
  const build = await buildDashboard(options);
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 4173;
  const operatorApi = dashboardOperatorApiConfig(options, host);
  const server = createServer((request, response) => {
    void serveDashboardRequest({
      build,
      host,
      operatorApi,
      request,
      response,
      rebuildDashboard: buildDashboard
    });
  });

  await listen(server, requestedPort, host);

  const port = serverPort(server);

  return {
    build,
    server,
    host,
    port,
    url: `http://${urlHost(host)}:${port}`,
    ...(operatorApi.enabled ? { operatorApi } : {})
  };
}
