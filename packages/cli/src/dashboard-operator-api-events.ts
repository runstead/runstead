import { createRunsteadId, type JsonObject, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import type { DashboardOperatorApiAction } from "./dashboard-operator-api-routes.js";
import type { BuildDashboardResult } from "./dashboard-types.js";

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
