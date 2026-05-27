import type { JsonObject } from "@runstead/core";

import type { ApprovedApprovalGrant } from "./approvals.js";
import type { ActionEnvelope } from "./policy.js";

interface ApprovalGrantLookupOptions {
  canonicalSignature?: string;
  approvalGrantScope?: string;
}

export function approvalGrantLookupOptions(
  action: ActionEnvelope
): ApprovalGrantLookupOptions {
  return {
    ...approvalGrantSignatureOption(action),
    ...approvalGrantScopeOption(action)
  };
}

export function approvalGrantAuditOutput(
  approvedGrant: ApprovedApprovalGrant | undefined
): JsonObject {
  return approvedGrant === undefined
    ? {}
    : {
        approvalId: approvedGrant.approval.id,
        approvalGrant: "used",
        approvalGrantMatch: approvedGrant.match,
        approvalGrantReuse: approvedGrant.reuse,
        approvalGrantActionId: approvedGrant.approvedActionId,
        ...(approvedGrant.canonicalSignature === undefined
          ? {}
          : { approvalGrantCanonicalSignature: approvedGrant.canonicalSignature }),
        ...(approvedGrant.approvalGrantScope === undefined
          ? {}
          : { approvalGrantScope: approvedGrant.approvalGrantScope })
      };
}

function approvalGrantSignatureOption(
  action: ActionEnvelope
): Partial<ApprovalGrantLookupOptions> {
  const signature = action.context?.canonicalSignature;

  return typeof signature === "string" && signature.length > 0
    ? { canonicalSignature: signature }
    : {};
}

function approvalGrantScopeOption(
  action: ActionEnvelope
): Partial<ApprovalGrantLookupOptions> {
  const scope = action.context?.approvalGrant?.scope;

  return typeof scope === "string" && scope.length > 0
    ? { approvalGrantScope: scope }
    : {};
}
