import type { RunsteadDatabase } from "@runstead/state-sqlite";

import { parsePendingPatchAction } from "./tool-router.js";
import type { CodexDirectPendingPatchResume } from "./worker-types.js";

export function readApprovedCodexDirectPendingPatch(
  database: RunsteadDatabase,
  approvalId: string
): CodexDirectPendingPatchResume | undefined {
  const row = database
    .prepare(
      `
      SELECT a.id AS approval_id, a.status, a.policy_decision_id, pd.action_json
      FROM approvals a
      JOIN policy_decisions pd ON pd.id = a.policy_decision_id
      WHERE a.id = ?
    `
    )
    .get(approvalId) as
    | {
        approval_id: string;
        status: string;
        policy_decision_id: string;
        action_json: string;
      }
    | undefined;

  if (row === undefined) {
    return undefined;
  }

  const action = parsePendingPatchAction(row.action_json);

  if (action === undefined) {
    return undefined;
  }

  if (row.status !== "approved") {
    return readApprovedCodexDirectPendingPatchBySignature(
      database,
      action.context.pendingPatch.canonicalSignature
    );
  }

  return {
    approvalId: row.approval_id,
    policyDecisionId: row.policy_decision_id,
    action,
    pendingPatch: action.context.pendingPatch
  };
}

function readApprovedCodexDirectPendingPatchBySignature(
  database: RunsteadDatabase,
  canonicalSignature: string
): CodexDirectPendingPatchResume | undefined {
  const rows = database
    .prepare(
      `
      SELECT a.id AS approval_id, a.policy_decision_id, pd.action_json
      FROM approvals a
      JOIN policy_decisions pd ON pd.id = a.policy_decision_id
      WHERE a.status = 'approved'
      ORDER BY a.updated_at DESC, a.id DESC
      LIMIT 50
    `
    )
    .all() as {
    approval_id: string;
    policy_decision_id: string;
    action_json: string;
  }[];

  for (const row of rows) {
    const action = parsePendingPatchAction(row.action_json);

    if (action?.context.pendingPatch.canonicalSignature !== canonicalSignature) {
      continue;
    }

    return {
      approvalId: row.approval_id,
      policyDecisionId: row.policy_decision_id,
      action,
      pendingPatch: action.context.pendingPatch
    };
  }

  return undefined;
}
