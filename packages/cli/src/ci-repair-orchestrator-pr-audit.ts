import type { RunsteadDatabase } from "@runstead/state-sqlite";

export interface CiRepairPullRequestAuditSummary {
  toolCalls: CiRepairPullRequestToolPolicy[];
}

export interface CiRepairPullRequestToolPolicy {
  actionType: string;
  status: string;
  decision?: string;
  risk?: string;
  ruleId?: string;
}

interface ToolPolicyRow {
  action_type: string;
  status: string;
  decision: string | null;
  risk: string | null;
  rule_id: string | null;
}

export function readCiRepairPullRequestAuditSummary(
  database: RunsteadDatabase,
  taskId: string
): CiRepairPullRequestAuditSummary {
  const rows = database
    .prepare(
      `
      SELECT
        tc.action_type,
        tc.status,
        pd.decision,
        pd.risk,
        pd.rule_id
      FROM tool_calls tc
      LEFT JOIN policy_decisions pd ON pd.id = tc.policy_decision_id
      WHERE tc.task_id = ?
        AND tc.status != 'requested'
      ORDER BY tc.started_at ASC, tc.id ASC
      LIMIT 16
    `
    )
    .all(taskId) as unknown as ToolPolicyRow[];

  return {
    toolCalls: rows.map((row) => ({
      actionType: row.action_type,
      status: row.status,
      ...(row.decision === null ? {} : { decision: row.decision }),
      ...(row.risk === null ? {} : { risk: row.risk }),
      ...(row.rule_id === null ? {} : { ruleId: row.rule_id })
    }))
  };
}

export function formatPullRequestToolPolicyLine(
  item: CiRepairPullRequestToolPolicy
): string {
  return [
    `- ${item.actionType}: ${item.status}`,
    item.decision === undefined ? undefined : `policy=${item.decision}`,
    item.risk === undefined ? undefined : `risk=${item.risk}`,
    item.ruleId === undefined ? undefined : `rule=${item.ruleId}`
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ");
}
