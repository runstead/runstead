import type {
  AuditLogEntry,
  ReplayAuditLifecycleResult
} from "./audit-export-types.js";

export function formatAuditTimeline(entries: AuditLogEntry[]): string {
  if (entries.length === 0) {
    return "No audit events.";
  }

  return entries
    .map((entry) =>
      [
        String(entry.id).padStart(4, " "),
        entry.createdAt,
        entry.type,
        `${entry.aggregateType}:${entry.aggregateId}`,
        auditPayloadSummary(entry.payload)
      ]
        .filter((part) => part.length > 0)
        .join(" ")
    )
    .join("\n");
}

export function formatAuditReplay(result: ReplayAuditLifecycleResult): string {
  if (result.entries.length === 0) {
    return `No audit events found for task ${result.taskId}.`;
  }

  return [
    `Replay task: ${result.taskId}`,
    `Related ids: ${result.relatedIds.join(", ")}`,
    formatAuditTimeline(result.entries)
  ].join("\n");
}

function auditPayloadSummary(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    return "";
  }

  const record = payload as Record<string, unknown>;
  const parts = [
    stringSummary("action", record.actionType),
    stringSummary("status", record.status),
    stringSummary("decision", record.decision),
    stringSummary("approval", record.approvalId),
    stringSummary("worker", record.workerType),
    stringSummary("task", record.taskId)
  ].filter((part): part is string => part !== undefined);

  return parts.length === 0 ? "" : `[${parts.join(" ")}]`;
}

function stringSummary(label: string, value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0
    ? `${label}=${value}`
    : undefined;
}
