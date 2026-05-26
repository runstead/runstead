import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { DashboardStartupTimelineGroup } from "./dashboard-types.js";

export function dashboardWorkerRunTimelineGroup(
  database: RunsteadDatabase
): DashboardStartupTimelineGroup {
  const rows = database
    .prepare(
      `
      SELECT id, task_id, worker_type, status, started_at, ended_at
      FROM worker_runs
      ORDER BY started_at DESC, id DESC
      LIMIT 25
    `
    )
    .all() as unknown as WorkerRunTimelineRow[];

  return {
    group: "worker_runs",
    title: "Worker Runs",
    items: rows.map((row) => ({
      id: row.id,
      title: row.worker_type,
      status: row.status,
      createdAt: row.started_at,
      detail: `task=${row.task_id}${row.ended_at === null ? "" : ` ended=${row.ended_at}`}`,
      artifacts: []
    }))
  };
}

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

export function dashboardToolCallTimelineGroup(
  database: RunsteadDatabase
): DashboardStartupTimelineGroup {
  const rows = database
    .prepare(
      `
      SELECT id, worker_run_id, task_id, action_type, status, started_at, ended_at
      FROM tool_calls
      ORDER BY started_at DESC, id DESC
      LIMIT 25
    `
    )
    .all() as unknown as ToolCallTimelineRow[];

  return {
    group: "tool_calls",
    title: "Tool Calls",
    items: rows.map((row) => ({
      id: row.id,
      title: row.action_type,
      status: row.status,
      createdAt: row.started_at,
      detail: `task=${row.task_id} worker=${row.worker_run_id}${row.ended_at === null ? "" : ` ended=${row.ended_at}`}`,
      artifacts: []
    }))
  };
}

export function dashboardApprovalTimelineGroup(
  database: RunsteadDatabase
): DashboardStartupTimelineGroup {
  const rows = database
    .prepare(
      `
      SELECT id, action_id, status, risk, reason, updated_at
      FROM approvals
      ORDER BY updated_at DESC, id DESC
      LIMIT 25
    `
    )
    .all() as unknown as ApprovalTimelineRow[];

  return {
    group: "approvals",
    title: "Approvals",
    items: rows.map((row) => ({
      id: row.id,
      title: row.action_id,
      status: row.status,
      createdAt: row.updated_at,
      detail: `${row.risk}: ${row.reason}`,
      artifacts: []
    }))
  };
}

export function dashboardEvidenceTimelineGroup(
  database: RunsteadDatabase
): DashboardStartupTimelineGroup {
  const rows = database
    .prepare(
      `
      SELECT id, type, subject_type, subject_id, summary, uri, created_at
      FROM evidence
      ORDER BY created_at DESC, id DESC
      LIMIT 25
    `
    )
    .all() as unknown as EvidenceTimelineRow[];

  return {
    group: "evidence",
    title: "Evidence",
    items: rows.map((row) => ({
      id: row.id,
      title: row.type,
      status: "recorded",
      createdAt: row.created_at,
      detail: `${row.subject_type}/${row.subject_id}: ${row.summary ?? "no summary"}`,
      artifacts: [row.uri]
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

interface WorkerRunTimelineRow {
  id: string;
  task_id: string;
  worker_type: string;
  status: string;
  started_at: string;
  ended_at: string | null;
}

interface ModelRequestTimelineRow {
  event_id: string;
  type: string;
  aggregate_id: string;
  payload_json: string;
  created_at: string;
}

interface ToolCallTimelineRow {
  id: string;
  worker_run_id: string;
  task_id: string;
  action_type: string;
  status: string;
  started_at: string;
  ended_at: string | null;
}

interface ApprovalTimelineRow {
  id: string;
  action_id: string;
  status: string;
  risk: string;
  reason: string;
  updated_at: string;
}

interface EvidenceTimelineRow {
  id: string;
  type: string;
  subject_type: string;
  subject_id: string;
  summary: string | null;
  uri: string;
  created_at: string;
}
