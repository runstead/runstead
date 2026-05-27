import type { Command } from "commander";

import {
  approveAndResumeApprovalCommand,
  approveApprovalCommand,
  denyApprovalCommand
} from "./approval-decision-actions.js";

export function registerApprovalDecisionCommands(approval: Command): void {
  approval
    .command("approve")
    .description("Approve a pending approval request.")
    .argument("<id>", "Approval id")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for approval decisions", "local-admin")
    .option("--decided-by <id>", "Approver id")
    .action(approveApprovalCommand);

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
    .action(approveAndResumeApprovalCommand);

  approval
    .command("deny")
    .description("Deny a pending approval request.")
    .argument("<id>", "Approval id")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for approval decisions", "local-admin")
    .option("--decided-by <id>", "Approver id")
    .action(denyApprovalCommand);
}
