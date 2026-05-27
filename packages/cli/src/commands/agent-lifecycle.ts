import type { Command } from "commander";

import {
  runAgentReportCommand,
  runAgentUndoCommand
} from "./agent-lifecycle-actions.js";
import { runAgentResumeCommand } from "./agent-resume-action.js";

export function registerAgentLifecycleCommands(command: Command): void {
  command
    .command("report")
    .description("Summarize a local agent task and its audit trail.")
    .argument("<task-id>", "Local agent task id")
    .option("--cwd <path>", "Workspace directory")
    .option("--json", "Print the report as JSON")
    .option("--markdown", "Print the report as Markdown")
    .option("--actor <id>", "RBAC subject for local agent reporting", "local-admin")
    .action(runAgentReportCommand);

  command
    .command("resume")
    .description("Resume a queued local agent task after an approval decision.")
    .argument("<task-or-approval-id>", "Local agent task id or approval id")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for local agent execution", "local-admin")
    .action(runAgentResumeCommand);

  command
    .command("undo")
    .description("Restore the checkpoint created before a local agent edit or repair.")
    .argument("<task-id>", "Local agent task id")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--allow-head-mismatch",
      "Restore even when the current HEAD differs from the checkpoint HEAD"
    )
    .option("--actor <id>", "RBAC subject for local agent undo", "local-admin")
    .action(runAgentUndoCommand);
}
