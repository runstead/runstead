import type { ApprovalRequest, PolicyDecisionRecord, Task } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import {
  findPolicyDecision,
  rowToApproval,
  taskForApproval,
  type ApprovalRow
} from "./approval-rows.js";

export interface ApprovalDetails {
  approval: ApprovalRequest;
  policyDecision?: PolicyDecisionRecord;
  task?: Task;
}

export function listApprovalRequests(input: {
  database: RunsteadDatabase;
  status?: ApprovalRequest["status"];
}): ApprovalRequest[] {
  const rows =
    input.status === undefined
      ? (input.database
          .prepare(
            `
            SELECT id, policy_decision_id, action_id, status, risk, reason,
                   requested_by, expires_at, decided_at, decided_by,
                   created_at, updated_at
            FROM approvals
            ORDER BY created_at DESC, id ASC
          `
          )
          .all() as unknown as ApprovalRow[])
      : (input.database
          .prepare(
            `
            SELECT id, policy_decision_id, action_id, status, risk, reason,
                   requested_by, expires_at, decided_at, decided_by,
                   created_at, updated_at
            FROM approvals
            WHERE status = ?
            ORDER BY created_at DESC, id ASC
          `
          )
          .all(input.status) as unknown as ApprovalRow[]);

  return rows.map(rowToApproval);
}

export function readApprovalDetails(input: {
  database: RunsteadDatabase;
  id: string;
}): ApprovalDetails {
  const row = input.database
    .prepare(
      `
      SELECT id, policy_decision_id, action_id, status, risk, reason,
             requested_by, expires_at, decided_at, decided_by,
             created_at, updated_at
      FROM approvals
      WHERE id = ?
    `
    )
    .get(input.id) as ApprovalRow | undefined;

  if (row === undefined) {
    throw new Error(`Approval not found: ${input.id}`);
  }

  const approval = rowToApproval(row);
  const policyDecision = findPolicyDecision(input.database, approval.policyDecisionId);
  const task = taskForApproval(input.database, approval);

  return {
    approval,
    ...(policyDecision === undefined ? {} : { policyDecision }),
    ...(task === undefined ? {} : { task })
  };
}
