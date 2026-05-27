import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { DashboardStartupTimelineGroup } from "./dashboard-types.js";

export function dashboardModelRequestTimelineGroup(
  database: RunsteadDatabase
): DashboardStartupTimelineGroup {
  const rows = database
    .prepare(
      `
      SELECT event_id, type, aggregate_id, payload_json, created_at
      FROM events
      WHERE type LIKE 'model_request.%'
      ORDER BY created_at DESC, id DESC
      LIMIT 25
    `
    )
    .all() as unknown as ModelRequestTimelineRow[];

  return {
    group: "model_requests",
    title: "Model Requests",
    items: rows.map((row) => ({
      id: row.event_id,
      title: row.type,
      status: modelRequestTimelineStatus(row.type),
      createdAt: row.created_at,
      detail: modelRequestTimelineDetail(row),
      artifacts: []
    }))
  };
}

function modelRequestTimelineStatus(type: string): string {
  if (type.endsWith(".retry")) {
    return "retry";
  }

  if (type.endsWith(".failed")) {
    return "failed";
  }

  if (type.endsWith(".completed")) {
    return "completed";
  }

  return "recorded";
}

function modelRequestTimelineDetail(row: ModelRequestTimelineRow): string {
  const payload = parseJsonRecord(row.payload_json);
  const attempt =
    typeof payload?.attempt === "number" ? `attempt=${payload.attempt}` : undefined;
  const reason =
    typeof payload?.reason === "string" ? `reason=${payload.reason}` : undefined;
  const delayMs =
    typeof payload?.delayMs === "number" ? `delay=${payload.delayMs}ms` : undefined;

  return [row.aggregate_id, attempt, reason, delayMs]
    .filter((part): part is string => part !== undefined)
    .join(" ");
}

function parseJsonRecord(
  value: string | null | undefined
): Record<string, unknown> | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ModelRequestTimelineRow {
  event_id: string;
  type: string;
  aggregate_id: string;
  payload_json: string;
  created_at: string;
}
