import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { readDashboardDaemonStatus } from "./dashboard-daemon-status.js";
import {
  dashboardOperatorActionDescriptor,
  dashboardOperatorMutationPath,
  executeDashboardOperatorApiAction,
  recordDashboardOperatorApiEvent
} from "./dashboard-operator-api-actions.js";
import { buildDashboardOperatorConsole } from "./dashboard-operator-console.js";
import { dashboardEventPayload } from "./dashboard-event-payload.js";
import {
  dashboardOperatorApiAuthError,
  dashboardOperatorApiError,
  listen,
  localBindHost,
  readJsonRequestBody,
  respondJson,
  serverPort,
  urlHost
} from "./dashboard-operator-api-http.js";
import { formatDashboardHtml } from "./dashboard-render.js";
import { readDashboardSnapshot } from "./dashboard-snapshot.js";
import { readDashboardStartupStatus } from "./dashboard-startup-status.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import type {
  BuildDashboardOptions,
  BuildDashboardResult,
  DashboardOperatorApiConfig,
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
    void serveDashboardRequest({ build, host, operatorApi, request, response });
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

function dashboardOperatorApiConfig(
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

async function serveDashboardRequest(input: {
  build: BuildDashboardResult;
  host: string;
  operatorApi: DashboardOperatorApiConfig;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const requestUrl = new URL(input.request.url ?? "/", `http://${input.host}`);
  const pathname = requestUrl.pathname;

  if (dashboardOperatorMutationPath(pathname)) {
    await serveDashboardOperatorApiRequest({
      build: input.build,
      operatorApi: input.operatorApi,
      request: input.request,
      response: input.response,
      pathname
    });
    return;
  }

  if (
    input.request.method !== undefined &&
    !["GET", "HEAD"].includes(input.request.method)
  ) {
    input.response.writeHead(405, {
      allow: "GET, HEAD",
      "content-type": "text/plain; charset=utf-8"
    });
    input.response.end("Method not allowed");
    return;
  }

  const target =
    pathname === "/" || pathname === "/index.html"
      ? {
          path: input.build.htmlPath,
          contentType: "text/html; charset=utf-8"
        }
      : pathname === "/state.json"
        ? {
            path: input.build.dataPath,
            contentType: "application/json; charset=utf-8"
          }
        : pathname === "/operator-actions.json"
          ? {
              path: input.build.operatorActionsPath,
              contentType: "application/json; charset=utf-8"
            }
          : undefined;

  if (target === undefined) {
    input.response.writeHead(404, {
      "content-type": "text/plain; charset=utf-8"
    });
    input.response.end("Not found");
    return;
  }

  try {
    const body = await readFile(target.path);

    input.response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": target.contentType
    });
    input.response.end(input.request.method === "HEAD" ? undefined : body);
  } catch (error) {
    input.response.writeHead(500, {
      "content-type": "text/plain; charset=utf-8"
    });
    input.response.end(error instanceof Error ? error.message : String(error));
  }
}

async function serveDashboardOperatorApiRequest(input: {
  build: BuildDashboardResult;
  operatorApi: DashboardOperatorApiConfig;
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
}): Promise<void> {
  if (!input.operatorApi.enabled) {
    respondJson(input.response, 404, {
      error: "operator_api_disabled",
      message:
        "Operator API is disabled. Restart dashboard serve with --enable-operator-api."
    });
    return;
  }

  if (input.request.method !== "POST") {
    respondJson(
      input.response,
      405,
      {
        error: "method_not_allowed",
        message: "Operator API endpoints require POST."
      },
      {
        allow: "POST"
      }
    );
    return;
  }

  const authError = dashboardOperatorApiAuthError(input.request, input.operatorApi);

  if (authError !== undefined) {
    respondJson(input.response, 403, authError);
    return;
  }

  let body: Record<string, unknown>;

  try {
    body = await readJsonRequestBody(input.request);
  } catch (error) {
    respondJson(input.response, 400, {
      error: "invalid_json",
      message: error instanceof Error ? error.message : String(error)
    });
    return;
  }

  const action = dashboardOperatorActionDescriptor(input.pathname, body);

  try {
    const result = await executeDashboardOperatorApiAction({
      build: input.build,
      actor: input.operatorApi.actor,
      action,
      body,
      rebuildDashboard: buildDashboard
    });

    recordDashboardOperatorApiEvent({
      build: input.build,
      actor: input.operatorApi.actor,
      action,
      status: "completed",
      result
    });
    respondJson(input.response, 200, {
      ok: true,
      action,
      result
    });
  } catch (error) {
    const apiError = dashboardOperatorApiError(error);

    recordDashboardOperatorApiEvent({
      build: input.build,
      actor: input.operatorApi.actor,
      action,
      status: "failed",
      error: apiError.message
    });
    respondJson(input.response, apiError.statusCode, {
      ok: false,
      action,
      error: apiError.code,
      message: apiError.message
    });
  }
}
