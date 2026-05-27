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

interface WorkerRunTimelineRow {
  id: string;
  task_id: string;
  worker_type: string;
  status: string;
  started_at: string;
  ended_at: string | null;
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
