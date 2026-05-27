import { requireRbacPermission } from "../cli-rbac.js";
import {
  approvalActionField,
  approvalGrantReuseSummary,
  approvalPolicyFingerprint,
  approvalResourceSummary,
  parseApprovalStatus
} from "./approval-format.js";

export interface ApprovalListCliOptions {
  cwd?: string;
  status?: string;
  actor: string;
}

export interface ApprovalShowCliOptions {
  cwd?: string;
  actor: string;
}

export async function listApprovalsCommand(
  options: ApprovalListCliOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "approval.read",
    action: "list approvals"
  });

  const { listApprovals } = await import("../approvals.js");
  const status = parseApprovalStatus(options.status);
  const result = listApprovals({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(status === undefined ? {} : { status })
  });

  if (result.approvals.length === 0) {
    console.log("No approvals found.");
    return;
  }

  for (const item of result.approvals) {
    console.log(
      `${item.status.padEnd(8)} ${item.id} ${item.risk} ${item.actionId}: ${item.reason}`
    );
  }
}

export async function showApprovalCommand(
  id: string,
  options: ApprovalShowCliOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "approval.read",
    action: "inspect approvals"
  });

  const { approvalActionMetadata, showApproval } = await import("../approvals.js");
  const result = showApproval({ ...options, id });
  const metadata = approvalActionMetadata(result.policyDecision);

  console.log(`Approval: ${result.approval.id}`);
  console.log(`Status: ${result.approval.status}`);
  console.log(`Risk: ${result.approval.risk}`);
  console.log(`Action: ${result.approval.actionId}`);
  console.log(`Policy decision: ${result.approval.policyDecisionId}`);
  console.log(`Reason: ${result.approval.reason}`);
  console.log(`Requested by: ${result.approval.requestedBy ?? "unknown"}`);
  console.log(`Expires: ${result.approval.expiresAt ?? "none"}`);
  console.log(`Decided by: ${result.approval.decidedBy ?? "none"}`);
  console.log(`Task: ${result.task?.id ?? "none"}`);

  if (result.policyDecision !== undefined) {
    console.log(`Policy: ${result.policyDecision.policyId}`);
    console.log(
      `Policy fingerprint: ${approvalPolicyFingerprint(result.policyDecision.result)}`
    );
    console.log(
      `Action type: ${approvalActionField(result.policyDecision.action, "actionType")}`
    );
    console.log(`Resource: ${approvalResourceSummary(result.policyDecision.action)}`);
    console.log(
      `Files touched: ${
        metadata.filesTouched.length === 0
          ? "unknown"
          : metadata.filesTouched.join(", ")
      }`
    );
    console.log(
      `Dependency impact: ${metadata.dependencyImpact.kind}${
        metadata.dependencyImpact.files.length === 0
          ? ""
          : ` (${metadata.dependencyImpact.files.join(", ")})`
      }`
    );
    console.log(`Risk class: ${metadata.riskClass ?? "unknown"}`);
    console.log(`Diff hash: ${metadata.diffHash ?? "unknown"}`);
    console.log(`Canonical signature: ${metadata.canonicalSignature ?? "unknown"}`);
    console.log(`Grant reuse: ${approvalGrantReuseSummary(metadata)}`);
    console.log(`Risk summary: ${metadata.riskSummary ?? "unknown"}`);
    console.log(
      `Obligations: ${
        result.policyDecision.obligations.length === 0
          ? "none"
          : result.policyDecision.obligations.join(", ")
      }`
    );
  }
}
