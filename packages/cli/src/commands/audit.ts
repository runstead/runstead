import type { Command } from "commander";

import { collectValues } from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";

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
    .action(async (options: AuditExportOptions) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "audit.read",
        action: "export audit logs"
      });

      const { exportAuditLog } = await import("../audit-export.js");
      const result = await exportAuditLog({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.output === undefined ? {} : { outputPath: options.output }),
        ...(options.type.length === 0 ? {} : { types: options.type }),
        ...(options.aggregateType === undefined
          ? {}
          : { aggregateType: options.aggregateType }),
        ...(options.aggregateId === undefined
          ? {}
          : { aggregateId: options.aggregateId })
      });

      if (result.outputPath === undefined) {
        process.stdout.write(result.contents);
        return;
      }

      console.log(`Exported audit log: ${result.outputPath}`);
      console.log(`Events: ${result.entries.length}`);
    });

  audit
    .command("timeline")
    .description("Print an ordered audit event timeline.")
    .option("--cwd <path>", "Workspace directory")
    .option("--type <event-type>", "Filter by event type", collectValues, [])
    .option("--aggregate-type <type>", "Filter by aggregate type")
    .option("--aggregate-id <id>", "Filter by aggregate id")
    .option("--actor <id>", "RBAC subject for audit access", "local-admin")
    .action(async (options: AuditTimelineOptions) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "audit.read",
        action: "read audit timelines"
      });

      const { exportAuditLog, formatAuditTimeline } =
        await import("../audit-export.js");
      const result = await exportAuditLog({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.type.length === 0 ? {} : { types: options.type }),
        ...(options.aggregateType === undefined
          ? {}
          : { aggregateType: options.aggregateType }),
        ...(options.aggregateId === undefined
          ? {}
          : { aggregateId: options.aggregateId })
      });

      console.log(formatAuditTimeline(result.entries));
    });

  audit
    .command("replay")
    .description("Replay related audit events for a task lifecycle.")
    .argument("<task-id>", "Task id")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for audit access", "local-admin")
    .action(async (taskId: string, options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "audit.read",
        action: "replay audit lifecycles"
      });

      const { formatAuditReplay, replayAuditLifecycle } =
        await import("../audit-export.js");
      const result = await replayAuditLifecycle({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        taskId
      });

      console.log(formatAuditReplay(result));
    });

  return audit;
}

interface AuditExportOptions {
  cwd?: string;
  output?: string;
  type: string[];
  aggregateType?: string;
  aggregateId?: string;
  actor: string;
}

interface AuditTimelineOptions {
  cwd?: string;
  type: string[];
  aggregateType?: string;
  aggregateId?: string;
  actor: string;
}
