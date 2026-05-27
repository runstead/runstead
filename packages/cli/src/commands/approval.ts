import type { Command } from "commander";

import { registerApprovalDecisionCommands } from "./approval-decisions.js";
import { registerApprovalReadCommands } from "./approval-read.js";

export function registerApprovalCommand(program: Command): Command {
  const approval = program.command("approval").description("Manage approvals.");

  registerApprovalReadCommands(approval);
  registerApprovalDecisionCommands(approval);

  return approval;
}
