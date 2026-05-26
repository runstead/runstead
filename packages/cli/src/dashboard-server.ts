import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";

import {
  dashboardOperatorActionDescriptor,
  dashboardOperatorMutationPath,
  executeDashboardOperatorApiAction,
  recordDashboardOperatorApiEvent
} from "./dashboard-operator-api-actions.js";
import {
  dashboardOperatorApiAuthError,
  dashboardOperatorApiError,
  localBindHost,
  readJsonRequestBody,
  respondJson
} from "./dashboard-operator-api-http.js";
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
  rebuildDashboard: DashboardRebuild;
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
      rebuildDashboard: input.rebuildDashboard
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
