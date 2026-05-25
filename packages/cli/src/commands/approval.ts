import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";

export function registerApprovalCommand(program: Command): Command {
  const approval = program.command("approval").description("Manage approvals.");

  approval
    .command("list")
    .description("List approval requests.")
    .option("--cwd <path>", "Workspace directory")
    .option("--status <status>", "Filter by approval status")
    .option("--actor <id>", "RBAC subject for approval access", "local-admin")
    .action(async (options: { cwd?: string; status?: string; actor: string }) => {
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
    });

  approval
    .command("show")
    .description("Show an approval request.")
    .argument("<id>", "Approval id")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for approval access", "local-admin")
    .action(async (id: string, options: { cwd?: string; actor: string }) => {
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
          `Action type: ${approvalActionField(
            result.policyDecision.action,
            "actionType"
          )}`
        );
        console.log(
          `Resource: ${approvalResourceSummary(result.policyDecision.action)}`
        );
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
    });

  approval
    .command("approve")
    .description("Approve a pending approval request.")
    .argument("<id>", "Approval id")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for approval decisions", "local-admin")
    .option("--decided-by <id>", "Approver id")
    .action(
      async (
        id: string,
        options: { cwd?: string; actor: string; decidedBy?: string }
      ) => {
        const actor = options.decidedBy ?? options.actor;
        const { approvalActionMetadata, decideApproval, showApproval } =
          await import("../approvals.js");
        const shown = showApproval({ ...options, id });
        const metadata = approvalActionMetadata(shown.policyDecision);
        const result = await decideApproval({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          id,
          decision: "approved",
          decidedBy: actor
        });

        console.log(`Approved: ${result.approval.id}`);
        console.log(`Task: ${shown.task?.id ?? "none"}`);
        console.log(`Grant reuse: ${approvalGrantReuseSummary(metadata)}`);
        if (shown.task !== undefined) {
          console.log(`Resume: runstead agent resume ${shown.task.id}`);
          console.log(
            `Resume by approval: runstead agent resume ${result.approval.id}`
          );
        }
      }
    );

  approval
    .command("approve-and-resume")
    .description("Approve a pending approval request and resume its local agent task.")
    .argument("<id>", "Approval id")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--actor <id>",
      "RBAC subject for approval and task execution",
      "local-admin"
    )
    .option("--decided-by <id>", "Approver id")
    .action(
      async (
        id: string,
        options: { cwd?: string; actor: string; decidedBy?: string }
      ) => {
        const actor = options.decidedBy ?? options.actor;
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor,
          permission: "task.run",
          action: "resume local agent tasks"
        });

        const { approvalActionMetadata, decideApproval, showApproval } =
          await import("../approvals.js");
        const { formatLocalAgentRunReport, localAgentRunExitCode, runLocalAgentTask } =
          await import("../local-agent.js");
        const shown = showApproval({ ...options, id });
        const metadata = approvalActionMetadata(shown.policyDecision);
        const result = await decideApproval({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          id,
          decision: "approved",
          decidedBy: actor
        });

        console.log(`Approved: ${result.approval.id}`);
        console.log(`Grant reuse: ${approvalGrantReuseSummary(metadata)}`);

        if (shown.task === undefined) {
          console.log(
            "Resume: skipped; no local agent task is associated with this approval."
          );
          return;
        }

        const resumed = await runLocalAgentTask({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          taskId: shown.task.id
        });
        const exitCode = localAgentRunExitCode(resumed);

        console.log(formatLocalAgentRunReport(resumed));
        if (exitCode !== 0) {
          process.exitCode = exitCode;
        }
      }
    );

  approval
    .command("deny")
    .description("Deny a pending approval request.")
    .argument("<id>", "Approval id")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for approval decisions", "local-admin")
    .option("--decided-by <id>", "Approver id")
    .action(
      async (
        id: string,
        options: { cwd?: string; actor: string; decidedBy?: string }
      ) => {
        const actor = options.decidedBy ?? options.actor;
        const { decideApproval } = await import("../approvals.js");
        const result = await decideApproval({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          id,
          decision: "denied",
          decidedBy: actor
        });

        console.log(`Denied: ${result.approval.id}`);
      }
    );

  return approval;
}

function parseApprovalStatus(
  value: string | undefined
): "pending" | "approved" | "denied" | "expired" | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === "pending" ||
    value === "approved" ||
    value === "denied" ||
    value === "expired"
  ) {
    return value;
  }

  throw new Error("--status must be pending, approved, denied, or expired");
}

function approvalPolicyFingerprint(result: unknown): string {
  if (!isRecord(result)) {
    return "unknown";
  }

  return typeof result.policyFingerprint === "string"
    ? result.policyFingerprint
    : "unknown";
}

function approvalActionField(action: unknown, field: string): string {
  if (!isRecord(action)) {
    return "unknown";
  }

  const value = action[field];
  return typeof value === "string" ? value : "unknown";
}

function approvalResourceSummary(action: unknown): string {
  if (!isRecord(action) || !isRecord(action.resource)) {
    return "unknown";
  }

  const type =
    typeof action.resource.type === "string" ? action.resource.type : "unknown";
  const identifier =
    typeof action.resource.id === "string"
      ? action.resource.id
      : typeof action.resource.path === "string"
        ? action.resource.path
        : undefined;

  return identifier === undefined ? type : `${type}:${identifier}`;
}

function approvalGrantReuseSummary(metadata: {
  canonicalSignature?: string;
  riskClass?: string;
  filesTouched: string[];
  diffHash?: string;
}): string {
  if (metadata.canonicalSignature === undefined) {
    return "same action id only";
  }

  const files =
    metadata.filesTouched.length === 0
      ? "unknown files"
      : metadata.filesTouched.join(", ");
  const risk = metadata.riskClass ?? "unknown risk";
  const diff = metadata.diffHash ?? "unknown diff";

  return `equivalent ${risk} actions touching ${files} with diff ${diff} can reuse canonical signature ${metadata.canonicalSignature}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
