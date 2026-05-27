import type { Command } from "commander";

import { collectValues } from "../cli-parsers.js";
import {
  exportAuditCommand,
  printAuditTimelineCommand,
  replayAuditCommand
} from "./audit-actions.js";

export function registerAuditCommand(program: Command): Command {
  const audit = program.command("audit").description("Export audit data.");

  audit
    .command("export")
    .description("Export the append-only event log as JSONL.")
    .option("--cwd <path>", "Workspace directory")
    .option("--output <path>", "Write JSONL to a file instead of stdout")
    .option("--type <event-type>", "Filter by event type", collectValues, [])
    .option("--aggregate-type <type>", "Filter by aggregate type")
    .option("--aggregate-id <id>", "Filter by aggregate id")
    .option("--actor <id>", "RBAC subject for audit access", "local-admin")
    .action(exportAuditCommand);

  audit
    .command("timeline")
    .description("Print an ordered audit event timeline.")
    .option("--cwd <path>", "Workspace directory")
    .option("--type <event-type>", "Filter by event type", collectValues, [])
    .option("--aggregate-type <type>", "Filter by aggregate type")
    .option("--aggregate-id <id>", "Filter by aggregate id")
    .option("--actor <id>", "RBAC subject for audit access", "local-admin")
    .action(printAuditTimelineCommand);

  audit
    .command("replay")
    .description("Replay related audit events for a task lifecycle.")
    .argument("<task-id>", "Task id")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for audit access", "local-admin")
    .action(replayAuditCommand);

  return audit;
}
