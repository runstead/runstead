import type { openRunsteadDatabase } from "@runstead/state-sqlite";

import type {
  ApprovalReportRow,
  EvidenceReportRow,
  EventReportRow,
  GoalReportRow,
  PolicyDecisionReportRow,
  TaskReportRow,
  WeeklyReportData
} from "./weekly-report-types.js";

export function readWeeklyReportData(
  database: ReturnType<typeof openRunsteadDatabase>,
  periodStart: string,
  periodEnd: string
): WeeklyReportData {
  const goals = database
    .prepare(
      `
      SELECT id, domain, title, status, priority, created_at, updated_at
      FROM goals
      ORDER BY status ASC, priority DESC, created_at DESC, id ASC
    `
    )
    .all() as unknown as GoalReportRow[];
  const tasks = database
    .prepare(
      `
      SELECT id, goal_id, domain, type, status, priority, attempt, max_attempts,
             updated_at
      FROM tasks
      WHERE (created_at >= ? AND created_at < ?)
         OR (updated_at >= ? AND updated_at < ?)
      ORDER BY updated_at DESC, id ASC
    `
    )
    .all(periodStart, periodEnd, periodStart, periodEnd) as unknown as TaskReportRow[];
  const evidence = database
    .prepare(
      `
      SELECT id, type, subject_type, subject_id, uri, summary, created_at
      FROM evidence
      WHERE created_at >= ? AND created_at < ?
      ORDER BY created_at DESC, id ASC
    `
    )
    .all(periodStart, periodEnd) as unknown as EvidenceReportRow[];
  const policyDecisions = database
    .prepare(
      `
      SELECT id, action_id, policy_id, decision, risk, rule_id, reason, created_at
      FROM policy_decisions
      WHERE created_at >= ? AND created_at < ?
      ORDER BY created_at DESC, id ASC
    `
    )
    .all(periodStart, periodEnd) as unknown as PolicyDecisionReportRow[];
  const approvals = database
    .prepare(
      `
      SELECT id, action_id, status, risk, reason, created_at, updated_at
      FROM approvals
      WHERE (created_at >= ? AND created_at < ?)
         OR (updated_at >= ? AND updated_at < ?)
      ORDER BY updated_at DESC, id ASC
    `
    )
    .all(
      periodStart,
      periodEnd,
      periodStart,
      periodEnd
    ) as unknown as ApprovalReportRow[];
  const events = database
    .prepare(
      `
      SELECT event_id, type, aggregate_type, aggregate_id, created_at
      FROM events
      WHERE created_at >= ? AND created_at < ?
      ORDER BY created_at DESC, id DESC
      LIMIT 25
    `
    )
    .all(periodStart, periodEnd) as unknown as EventReportRow[];

  return {
    goals,
    tasks,
    evidence,
    policyDecisions,
    approvals,
    events
  };
}
