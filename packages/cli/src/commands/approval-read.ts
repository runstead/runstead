import type { Command } from "commander";

import { listApprovalsCommand, showApprovalCommand } from "./approval-read-actions.js";

export function registerApprovalReadCommands(approval: Command): void {
  approval
    .command("list")
    .description("List approval requests.")
    .option("--cwd <path>", "Workspace directory")
    .option("--status <status>", "Filter by approval status")
    .option("--actor <id>", "RBAC subject for approval access", "local-admin")
    .action(listApprovalsCommand);

  approval
    .command("show")
    .description("Show an approval request.")
    .argument("<id>", "Approval id")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for approval access", "local-admin")
    .action(showApprovalCommand);
}
