import type { RunsteadDatabase } from "@runstead/state-sqlite";

import {
  parseJsonObject,
  toolCallFailureInsight,
  toolCallResource,
  toolCallSummary,
  type LocalAgentToolFailureKind
} from "./local-agent-report-tool-call.js";

export interface LocalAgentAuditCount {
  name: string;
  status: string;
  count: number;
}

export interface LocalAgentPolicyDecisionCount {
  decision: string;
  risk: string;
  count: number;
}

export interface LocalAgentAuditSummary {
  workerRuns: LocalAgentAuditCount[];
  toolCalls: LocalAgentAuditCount[];
  policyDecisions: LocalAgentPolicyDecisionCount[];
  approvals: LocalAgentAuditCount[];
}

export interface LocalAgentReportToolCall {
  id: string;
  actionType: string;
  status: string;
  policyDecisionId?: string;
  resource?: string;
  summary?: string;
  failureKind?: LocalAgentToolFailureKind;
  recoverable?: boolean;
  failureExplanation?: string;
}

export function summarizeLocalAgentAudit(
  database: RunsteadDatabase,
  taskId: string
): LocalAgentAuditSummary {
  const workerRuns = readAuditCounts(
    database,
    `
      SELECT worker_type AS name, status, COUNT(*) AS count
      FROM worker_runs
      WHERE task_id = ?
      GROUP BY worker_type, status
      ORDER BY worker_type, status
    `,
    taskId
  );
  const toolCalls = readAuditCounts(
    database,
    `
      SELECT action_type AS name, status, COUNT(*) AS count
      FROM tool_calls
      WHERE task_id = ?
      GROUP BY action_type, status
      ORDER BY action_type, status
    `,
    taskId
  );
  const policyDecisions = readPolicyDecisionCounts(
    database,
    `
      SELECT pd.decision, pd.risk, COUNT(*) AS count
      FROM policy_decisions pd
      JOIN tool_calls tc ON tc.policy_decision_id = pd.id
      WHERE tc.task_id = ?
      GROUP BY pd.decision, pd.risk
      ORDER BY pd.decision, pd.risk
    `,
    taskId
  );
  const approvals = readAuditCounts(
    database,
    `
      SELECT a.status AS name, a.risk AS status, COUNT(*) AS count
      FROM approvals a
      JOIN policy_decisions pd ON pd.id = a.policy_decision_id
      JOIN tool_calls tc ON tc.policy_decision_id = pd.id
      WHERE tc.task_id = ?
      GROUP BY a.status, a.risk
      ORDER BY a.status, a.risk
    `,
    taskId
  );

  return {
    workerRuns,
    toolCalls,
    policyDecisions,
    approvals
  };
}

export function readLocalAgentReportToolCalls(
  database: RunsteadDatabase,
  taskId: string
): LocalAgentReportToolCall[] {
  return (
    database
      .prepare(
        `
          SELECT id, action_type, status, policy_decision_id, input_json, output_json
          FROM tool_calls
          WHERE task_id = ?
          ORDER BY started_at, id
        `
      )
      .all(taskId) as unknown[]
  ).map((row) => {
    const record = row as Record<string, unknown>;
    const input = parseJsonObject(record.input_json);
    const output = parseJsonObject(record.output_json);

    return {
      id: String(record.id),
      actionType: String(record.action_type),
      status: String(record.status),
      ...(typeof record.policy_decision_id === "string"
        ? { policyDecisionId: record.policy_decision_id }
        : {}),
      ...toolCallResource(input),
      ...toolCallSummary(output),
      ...toolCallFailureInsight({
        actionType: String(record.action_type),
        status: String(record.status),
        output
      })
    };
  });
}

function readAuditCounts(
  database: RunsteadDatabase,
  sql: string,
  taskId: string
): LocalAgentAuditCount[] {
  return (database.prepare(sql).all(taskId) as unknown[]).map((row) => {
    const record = row as Record<string, unknown>;

    return {
      name: String(record.name),
      status: String(record.status),
      count: Number(record.count)
    };
  });
}

function readPolicyDecisionCounts(
  database: RunsteadDatabase,
  sql: string,
  taskId: string
): LocalAgentPolicyDecisionCount[] {
  return (database.prepare(sql).all(taskId) as unknown[]).map((row) => {
    const record = row as Record<string, unknown>;

    return {
      decision: String(record.decision),
      risk: String(record.risk),
      count: Number(record.count)
    };
  });
}
