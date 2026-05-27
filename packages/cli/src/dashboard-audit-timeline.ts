import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { DashboardStartupTimelineGroup } from "./dashboard-types.js";
export {
  dashboardToolCallTimelineGroup,
  dashboardWorkerRunTimelineGroup
} from "./dashboard-execution-timeline.js";
export { dashboardModelRequestTimelineGroup } from "./dashboard-model-request-timeline.js";

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
