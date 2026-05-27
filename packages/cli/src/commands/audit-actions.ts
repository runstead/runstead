import { requireRbacPermission } from "../cli-rbac.js";

export interface AuditExportOptions {
  cwd?: string;
  output?: string;
  type: string[];
  aggregateType?: string;
  aggregateId?: string;
  actor: string;
}

export interface AuditTimelineOptions {
  cwd?: string;
  type: string[];
  aggregateType?: string;
  aggregateId?: string;
  actor: string;
}

export interface AuditReplayOptions {
  cwd?: string;
  actor: string;
}

export async function exportAuditCommand(options: AuditExportOptions): Promise<void> {
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
    ...(options.aggregateId === undefined ? {} : { aggregateId: options.aggregateId })
  });

  if (result.outputPath === undefined) {
    process.stdout.write(result.contents);
    return;
  }

  console.log(`Exported audit log: ${result.outputPath}`);
  console.log(`Events: ${result.entries.length}`);
}

export async function printAuditTimelineCommand(
  options: AuditTimelineOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "audit.read",
    action: "read audit timelines"
  });

  const { exportAuditLog, formatAuditTimeline } = await import("../audit-export.js");
  const result = await exportAuditLog({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.type.length === 0 ? {} : { types: options.type }),
    ...(options.aggregateType === undefined
      ? {}
      : { aggregateType: options.aggregateType }),
    ...(options.aggregateId === undefined ? {} : { aggregateId: options.aggregateId })
  });

  console.log(formatAuditTimeline(result.entries));
}

export async function replayAuditCommand(
  taskId: string,
  options: AuditReplayOptions
): Promise<void> {
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
}
