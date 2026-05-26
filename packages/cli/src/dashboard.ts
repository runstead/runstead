import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { readDashboardDaemonStatus } from "./dashboard-daemon-status.js";
import { buildDashboardOperatorConsole } from "./dashboard-operator-console.js";
import { dashboardEventPayload } from "./dashboard-event-payload.js";
import { listen, serverPort, urlHost } from "./dashboard-operator-api-http.js";
import { formatDashboardHtml } from "./dashboard-render.js";
import {
  dashboardOperatorApiConfig,
  serveDashboardRequest
} from "./dashboard-server.js";
import { readDashboardSnapshot } from "./dashboard-snapshot.js";
import { readDashboardStartupStatus } from "./dashboard-startup-status.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import type {
  BuildDashboardOptions,
  BuildDashboardResult,
  DashboardSnapshot,
  ServeDashboardOptions,
  ServeDashboardResult
} from "./dashboard-types.js";

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

export async function buildDashboard(
  options: BuildDashboardOptions = {}
): Promise<BuildDashboardResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedState = await requireRunsteadStateDb(cwd);
  const root = resolvedState.root;
  const generatedAt = (options.now ?? new Date()).toISOString();
  const stateDb = resolvedState.stateDb;
  const outputDir =
    options.outputDir === undefined
      ? join(root, "dashboard")
      : resolve(options.outputDir);
  const htmlPath = join(outputDir, "index.html");
  const dataPath = join(outputDir, "state.json");
  const operatorActionsPath = join(outputDir, "operator-actions.json");
  const database = openRunsteadDatabase(stateDb);

  try {
    const baseSnapshot = readDashboardSnapshot(database, generatedAt);
    const daemon = await readDashboardDaemonStatus(root, generatedAt);
    const startup = await readDashboardStartupStatus({
      cwd,
      root,
      generatedAt,
      database
    });
    const snapshot: DashboardSnapshot = {
      ...baseSnapshot,
      daemon,
      startup,
      operator: buildDashboardOperatorConsole({
        cwd,
        daemon,
        startup,
        approvals: baseSnapshot.approvals
      })
    };
    const html = formatDashboardHtml(snapshot);
    const event: RunsteadEvent = {
      eventId: createRunsteadId("evt"),
      type: "dashboard.generated",
      aggregateType: "dashboard",
      aggregateId: "local",
      payload: dashboardEventPayload(snapshot, htmlPath, dataPath),
      createdAt: generatedAt
    };

    await mkdir(outputDir, { recursive: true });
    await writeFile(dataPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await writeFile(
      operatorActionsPath,
      `${JSON.stringify(snapshot.operator, null, 2)}\n`,
      "utf8"
    );
    await writeFile(htmlPath, html, "utf8");
    appendEventAndProject(database, { event });

    return {
      cwd,
      root,
      stateDb,
      outputDir,
      htmlPath,
      dataPath,
      operatorActionsPath,
      snapshot,
      event
    };
  } finally {
    database.close();
  }
}

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
