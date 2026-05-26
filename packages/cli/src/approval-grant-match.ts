import type { ApprovalGrantMatchKind } from "./approvals.js";

export interface ApprovalGrantActionRow {
  action_id: string;
  action_json: string | null;
}

export interface ApprovalGrantMatchInput {
  actionId: string;
  canonicalSignature?: string;
  approvalGrantScope?: string;
}

export interface ApprovalGrantMatchResult {
  match: ApprovalGrantMatchKind;
  canonicalSignature?: string;
  approvalGrantScope?: string;
  reuse: "single_use" | "scoped_until_expiry";
}

export function approvalGrantMatchForAction(
  row: ApprovalGrantActionRow,
  options: ApprovalGrantMatchInput
): ApprovalGrantMatchResult | undefined {
  const reuse = approvalActionGrantReuse(row.action_json);

  if (row.action_id === options.actionId) {
    return { match: "action_id", reuse };
  }

  const canonicalSignature = approvalActionCanonicalSignature(row.action_json);

  if (
    options.canonicalSignature !== undefined &&
    canonicalSignature === options.canonicalSignature
  ) {
    return {
      match: "canonical_signature",
      canonicalSignature,
      reuse
    };
  }

  const approvalGrantScope = approvalActionGrantScope(row.action_json);

  if (
    reuse === "scoped_until_expiry" &&
    options.approvalGrantScope !== undefined &&
    approvalGrantScope === options.approvalGrantScope
  ) {
    return {
      match: "approval_grant_scope",
      approvalGrantScope,
      reuse
    };
  }

  return undefined;
}

function approvalActionCanonicalSignature(
  actionJson: string | null
): string | undefined {
  if (actionJson === null) {
    return undefined;
  }

  try {
    const action = JSON.parse(actionJson) as unknown;
    const context = isRecord(action) && isRecord(action.context) ? action.context : {};

    return typeof context.canonicalSignature === "string"
      ? context.canonicalSignature
      : undefined;
  } catch {
    return undefined;
  }
}

function approvalActionGrantReuse(
  actionJson: string | null
): "single_use" | "scoped_until_expiry" {
  if (actionJson === null) {
    return "single_use";
  }

  try {
    const action = JSON.parse(actionJson) as unknown;
    const context = isRecord(action) && isRecord(action.context) ? action.context : {};
    const approvalGrant = isRecord(context.approvalGrant) ? context.approvalGrant : {};

    return approvalGrant.mode === "scoped_until_expiry"
      ? "scoped_until_expiry"
      : "single_use";
  } catch {
    return "single_use";
  }
}

function approvalActionGrantScope(actionJson: string | null): string | undefined {
  if (actionJson === null) {
    return undefined;
  }

  try {
    const action = JSON.parse(actionJson) as unknown;
    const context = isRecord(action) && isRecord(action.context) ? action.context : {};
    const approvalGrant = isRecord(context.approvalGrant) ? context.approvalGrant : {};

    return typeof approvalGrant.scope === "string" ? approvalGrant.scope : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
