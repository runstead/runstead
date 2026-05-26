import {
  ApprovalRequestSchema,
  type ApprovalRequest,
  type JsonObject,
  type PolicyDecisionRecord,
  PolicyDecisionRecordSchema,
  type Task,
  TaskSchema
} from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

export interface ApprovalRow {
  id: string;
  policy_decision_id: string;
  action_id: string;
  status: string;
  risk: string;
  reason: string;
  requested_by: string | null;
  expires_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApprovedApprovalRow extends ApprovalRow {
  action_json: string | null;
}

export interface PolicyDecisionRow {
  id: string;
  action_id: string;
  policy_id: string;
  decision: string;
  risk: string;
  rule_id: string | null;
  reason: string;
  obligations_json: string;
  action_json: string;
  result_json: string;
  created_at: string;
}

export interface TaskRow {
  id: string;
  goal_id: string;
  domain: string;
  type: string;
  status: string;
  priority: string;
  attempt: number;
  max_attempts: number;
  input_json: string;
  output_json: string | null;
  verifiers_json: string;
  created_at: string;
  updated_at: string;
}

export function rowToApproval(row: ApprovalRow): ApprovalRequest {
  return ApprovalRequestSchema.parse({
    id: row.id,
    policyDecisionId: row.policy_decision_id,
    actionId: row.action_id,
    status: row.status,
    risk: row.risk,
    reason: row.reason,
    ...(row.requested_by === null ? {} : { requestedBy: row.requested_by }),
    ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
    ...(row.decided_at === null ? {} : { decidedAt: row.decided_at }),
    ...(row.decided_by === null ? {} : { decidedBy: row.decided_by }),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

export function findPolicyDecision(
  database: RunsteadDatabase,
  id: string
): PolicyDecisionRecord | undefined {
  const row = database
    .prepare(
      `
      SELECT id, action_id, policy_id, decision, risk, rule_id, reason,
             obligations_json, action_json, result_json, created_at
      FROM policy_decisions
      WHERE id = ?
    `
    )
    .get(id) as PolicyDecisionRow | undefined;

  return row === undefined ? undefined : rowToPolicyDecision(row);
}

export function taskForApproval(
  database: RunsteadDatabase,
  approval: ApprovalRequest
): Task | undefined {
  const row = database
    .prepare(
      `
      SELECT t.id, t.goal_id, t.domain, t.type, t.status, t.priority, t.attempt,
             t.max_attempts, t.input_json, t.output_json, t.verifiers_json,
             t.created_at, t.updated_at
      FROM tool_calls tc
      JOIN tasks t ON t.id = tc.task_id
      WHERE tc.policy_decision_id = ?
      ORDER BY tc.started_at DESC, tc.id ASC
      LIMIT 1
    `
    )
    .get(approval.policyDecisionId) as TaskRow | undefined;

  return row === undefined ? undefined : rowToTask(row);
}

export function readPendingApprovalForDecision(
  database: RunsteadDatabase,
  id: string
): ApprovalRequest {
  const pendingRow = database
    .prepare(
      `
      SELECT id, policy_decision_id, action_id, status, risk, reason,
             requested_by, expires_at, decided_at, decided_by,
             created_at, updated_at
      FROM approvals
      WHERE id = ? AND status = 'pending'
    `
    )
    .get(id) as ApprovalRow | undefined;

  if (pendingRow !== undefined) {
    return rowToApproval(pendingRow);
  }

  const row = database
    .prepare(
      `
      SELECT id, policy_decision_id, action_id, status, risk, reason,
             requested_by, expires_at, decided_at, decided_by,
             created_at, updated_at
      FROM approvals
      WHERE id = ?
    `
    )
    .get(id) as ApprovalRow | undefined;

  if (row === undefined) {
    throw new Error(`Approval not found: ${id}`);
  }

  const approval = rowToApproval(row);

  throw new Error(`Approval ${id} is ${approval.status}, expected pending`);
}

function rowToPolicyDecision(row: PolicyDecisionRow): PolicyDecisionRecord {
  return PolicyDecisionRecordSchema.parse({
    id: row.id,
    actionId: row.action_id,
    policyId: row.policy_id,
    decision: row.decision,
    risk: row.risk,
    ...(row.rule_id === null ? {} : { ruleId: row.rule_id }),
    reason: row.reason,
    obligations: JSON.parse(row.obligations_json) as string[],
    action: JSON.parse(row.action_json) as JsonObject,
    result: JSON.parse(row.result_json) as JsonObject,
    createdAt: row.created_at
  });
}

function rowToTask(row: TaskRow): Task {
  return TaskSchema.parse({
    id: row.id,
    goalId: row.goal_id,
    domain: row.domain,
    type: row.type,
    status: row.status,
    priority: row.priority,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    input: JSON.parse(row.input_json) as JsonObject,
    ...(row.output_json === null
      ? {}
      : { output: JSON.parse(row.output_json) as JsonObject }),
    verifiers: JSON.parse(row.verifiers_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}
