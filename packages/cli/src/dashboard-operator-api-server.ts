import type { IncomingMessage, ServerResponse } from "node:http";

import {
  dashboardOperatorActionDescriptor,
  executeDashboardOperatorApiAction,
  recordDashboardOperatorApiEvent
} from "./dashboard-operator-api-actions.js";
import { dashboardOperatorApiAuthError } from "./dashboard-operator-api-auth.js";
import { dashboardOperatorApiError } from "./dashboard-operator-api-http.js";
import { readJsonRequestBody, respondJson } from "./dashboard-http-json.js";
import type {
  BuildDashboardResult,
  DashboardOperatorApiConfig,
  ServeDashboardOptions
} from "./dashboard-types.js";

type DashboardRebuild = (
  options: ServeDashboardOptions
) => Promise<BuildDashboardResult>;

export async function serveDashboardOperatorApiRequest(input: {
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
