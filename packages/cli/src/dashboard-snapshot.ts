import type { RunsteadDatabase } from "@runstead/state-sqlite";

import {
  rowToApproval,
  rowToEvent,
  rowToGoal,
  rowToRepository,
  rowToTask,
  type ApprovalRow,
  type EventRow,
  type GoalRow,
  type RepositoryRow,
  type TaskRow
} from "./dashboard-row-mappers.js";
import type { DashboardSnapshot, DashboardSummary } from "./dashboard-types.js";

export function readDashboardSnapshot(
  database: RunsteadDatabase,
  generatedAt: string
): DashboardSnapshot {
  const repositories = (
    database
      .prepare(
        `
        SELECT id, alias, local_path, remote_url, status
        FROM repositories
        ORDER BY alias ASC, id ASC
      `
      )
      .all() as unknown as RepositoryRow[]
  ).map(rowToRepository);
  const goals = (
    database
      .prepare(
        `
        SELECT id, domain, title, status, priority, scope_json, updated_at
        FROM goals
        ORDER BY updated_at DESC, id ASC
        LIMIT 50
      `
      )
      .all() as unknown as GoalRow[]
  ).map(rowToGoal);
  const tasks = (
    database
      .prepare(
        `
        SELECT id, goal_id, type, status, priority, updated_at
        FROM tasks
        ORDER BY updated_at DESC, id ASC
        LIMIT 50
      `
      )
      .all() as unknown as TaskRow[]
  ).map(rowToTask);
  const approvals = (
    database
      .prepare(
        `
        SELECT id, action_id, status, risk, reason, updated_at
        FROM approvals
        ORDER BY updated_at DESC, id ASC
        LIMIT 25
      `
      )
      .all() as unknown as ApprovalRow[]
  ).map(rowToApproval);
  const events = (
    database
      .prepare(
        `
        SELECT event_id, type, aggregate_type, aggregate_id, created_at
        FROM events
        ORDER BY created_at DESC, id DESC
        LIMIT 25
      `
      )
      .all() as unknown as EventRow[]
  ).map(rowToEvent);

  return {
    generatedAt,
    summary: readDashboardSummary(database),
    repositories,
    goals,
    tasks,
    approvals,
    events,
    daemon: {
      available: false
    },
    startup: {
      available: false,
      timelineGroups: [],
      staleEvidence: []
    },
    operator: {
      actions: [],
      pendingApprovals: [],
      blockerCount: 0,
      staleEvidenceCount: 0
    }
  };
}

function readDashboardSummary(database: RunsteadDatabase): DashboardSummary {
  return {
    repositories: countRows(database, "repositories"),
    activeGoals: countRows(database, "goals", "status = 'active'"),
    queuedTasks: countRows(database, "tasks", "status = 'queued'"),
    runningTasks: countRows(database, "tasks", "status IN ('claimed', 'running')"),
    failedTasks: countRows(database, "tasks", "status = 'failed'"),
    pendingApprovals: countRows(database, "approvals", "status = 'pending'")
  };
}

function countRows(database: RunsteadDatabase, table: string, where?: string): number {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count FROM ${table}${where === undefined ? "" : ` WHERE ${where}`}`
    )
    .get() as { count: number };

  return row.count;
}
