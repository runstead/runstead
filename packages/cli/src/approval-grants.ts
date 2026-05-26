import type { ApprovalRequest } from "@runstead/core";
import { appendEventAndProject, type RunsteadDatabase } from "@runstead/state-sqlite";

import {
  approvalGrantMatchForAction,
  type ApprovalGrantMatchKind
} from "./approval-grant-match.js";
import { rowToApproval, type ApprovedApprovalRow } from "./approval-rows.js";
import { createApprovalExpirationTransition } from "./approval-transitions.js";

export interface FindApprovedApprovalOptions {
  database: RunsteadDatabase;
  actionId: string;
  canonicalSignature?: string;
  approvalGrantScope?: string;
  now?: Date;
}

export interface ApprovedApprovalGrant {
  approval: ApprovalRequest;
  match: ApprovalGrantMatchKind;
  approvedActionId: string;
  canonicalSignature?: string;
  approvalGrantScope?: string;
  reuse: "single_use" | "scoped_until_expiry";
}

export interface ExpireApprovalGrantOptions {
  database: RunsteadDatabase;
  approval: ApprovalRequest;
  now?: Date;
}

export function findApprovedApprovalForAction(
  options: FindApprovedApprovalOptions
): ApprovalRequest | undefined {
  return findApprovedApprovalGrantForAction(options)?.approval;
}

export function findApprovedApprovalGrantForAction(
  options: FindApprovedApprovalOptions
): ApprovedApprovalGrant | undefined {
  const now = options.now ?? new Date();
  const rows = options.database
    .prepare(
      `
      SELECT a.id, a.policy_decision_id, a.action_id, a.status, a.risk, a.reason,
             a.requested_by, a.expires_at, a.decided_at, a.decided_by,
             a.created_at, a.updated_at, pd.action_json
      FROM approvals a
      LEFT JOIN policy_decisions pd ON pd.id = a.policy_decision_id
      WHERE a.status = 'approved'
      ORDER BY a.decided_at ASC, a.created_at ASC, a.id ASC
    `
    )
    .all() as unknown as ApprovedApprovalRow[];

  for (const row of rows) {
    const grantMatch = approvalGrantMatchForAction(row, options);

    if (grantMatch === undefined) {
      continue;
    }

    const approval = rowToApproval(row);

    if (
      approval.expiresAt !== undefined &&
      Date.parse(approval.expiresAt) <= now.getTime()
    ) {
      expireApprovalGrant({
        database: options.database,
        approval,
        now
      });
      continue;
    }

    return {
      approval,
      match: grantMatch.match,
      approvedActionId: row.action_id,
      reuse: grantMatch.reuse,
      ...(grantMatch.canonicalSignature === undefined
        ? {}
        : { canonicalSignature: grantMatch.canonicalSignature }),
      ...(grantMatch.approvalGrantScope === undefined
        ? {}
        : { approvalGrantScope: grantMatch.approvalGrantScope })
    };
  }

  return undefined;
}

export function expireApprovalGrant(
  options: ExpireApprovalGrantOptions
): ApprovalRequest {
  const transition = createApprovalExpirationTransition(options);

  appendEventAndProject(options.database, transition.entry);

  return transition.approval;
}

export type { ApprovalGrantMatchKind };
