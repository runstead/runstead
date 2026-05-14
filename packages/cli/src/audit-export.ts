import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDbSync } from "./runstead-root.js";

export interface ExportAuditLogOptions {
  cwd?: string;
  outputPath?: string;
  types?: string[];
  aggregateType?: string;
  aggregateId?: string;
}

export interface AuditLogEntry {
  id: number;
  eventId: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  createdAt: string;
}

export interface ExportAuditLogResult {
  root: string;
  stateDb: string;
  entries: AuditLogEntry[];
  contents: string;
  outputPath?: string;
}

export interface ReplayAuditLifecycleOptions {
  cwd?: string;
  taskId: string;
}

export interface ReplayAuditLifecycleResult {
  root: string;
  stateDb: string;
  taskId: string;
  relatedIds: string[];
  entries: AuditLogEntry[];
}

interface AuditEventRow {
  id: number;
  event_id: string;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload_json: string;
  created_at: string;
}

export async function exportAuditLog(
  options: ExportAuditLogOptions = {}
): Promise<ExportAuditLogResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedState = requireRunsteadStateDbSync(cwd);
  const stateDb = resolvedState.stateDb;
  const database = openRunsteadDatabase(stateDb);

  try {
    const entries = readAuditEntries(database).filter((entry) =>
      matchesAuditFilters(entry, options)
    );
    const contents =
      entries.length === 0
        ? ""
        : `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
    const outputPath =
      options.outputPath === undefined ? undefined : resolve(options.outputPath);

    if (outputPath !== undefined) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, contents, "utf8");
    }

    return {
      root: resolvedState.root,
      stateDb,
      entries,
      contents,
      ...(outputPath === undefined ? {} : { outputPath })
    };
  } finally {
    database.close();
  }
}

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

export async function replayAuditLifecycle(
  options: ReplayAuditLifecycleOptions
): Promise<ReplayAuditLifecycleResult> {
  const audit = await exportAuditLog({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd })
  });
  const { entries, relatedIds } = collectAuditLifecycleEntries(
    audit.entries,
    options.taskId
  );

  return {
    root: audit.root,
    stateDb: audit.stateDb,
    taskId: options.taskId,
    relatedIds,
    entries
  };
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

function collectAuditLifecycleEntries(
  entries: AuditLogEntry[],
  taskId: string
): { entries: AuditLogEntry[]; relatedIds: string[] } {
  const relatedIds = new Set<string>([taskId]);
  const selectedIds = new Set<number>();
  let changed = true;

  while (changed) {
    changed = false;

    for (const entry of entries) {
      if (selectedIds.has(entry.id) || !entryReferencesAnyId(entry, relatedIds)) {
        continue;
      }

      selectedIds.add(entry.id);
      changed = true;
      relatedIds.add(entry.aggregateId);

      for (const id of collectReferenceIds(entry.payload)) {
        relatedIds.add(id);
      }
    }
  }

  return {
    entries: entries.filter((entry) => selectedIds.has(entry.id)),
    relatedIds: [...relatedIds].sort()
  };
}

function entryReferencesAnyId(entry: AuditLogEntry, ids: Set<string>): boolean {
  return (
    ids.has(entry.aggregateId) ||
    collectReferenceIds(entry.payload).some((id) => ids.has(id))
  );
}

function collectReferenceIds(value: unknown): string[] {
  const ids: string[] = [];
  collectReferenceIdsInto(value, ids);
  return ids;
}

function collectReferenceIdsInto(value: unknown, ids: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectReferenceIdsInto(item, ids);
    }
    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (isReferenceIdKey(key)) {
      if (typeof child === "string") {
        ids.push(child);
      } else if (Array.isArray(child)) {
        ids.push(...child.filter((item): item is string => typeof item === "string"));
      }
    }

    collectReferenceIdsInto(child, ids);
  }
}

function isReferenceIdKey(key: string): boolean {
  return key === "id" || key.endsWith("Id") || key.endsWith("Ids");
}

function readAuditEntries(database: ReturnType<typeof openRunsteadDatabase>) {
  const rows = database
    .prepare(
      `
      SELECT id, event_id, type, aggregate_type, aggregate_id, payload_json,
             created_at
      FROM events
      ORDER BY id ASC
    `
    )
    .all() as unknown as AuditEventRow[];

  return rows.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    type: row.type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    payload: JSON.parse(row.payload_json) as unknown,
    createdAt: row.created_at
  }));
}

function matchesAuditFilters(
  entry: AuditLogEntry,
  options: ExportAuditLogOptions
): boolean {
  if (
    options.types !== undefined &&
    options.types.length > 0 &&
    !options.types.includes(entry.type)
  ) {
    return false;
  }

  if (
    options.aggregateType !== undefined &&
    entry.aggregateType !== options.aggregateType
  ) {
    return false;
  }

  if (options.aggregateId !== undefined && entry.aggregateId !== options.aggregateId) {
    return false;
  }

  return true;
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
