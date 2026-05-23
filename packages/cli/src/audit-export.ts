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
    const entries = readAuditEntries(database, options);
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

export function replayAuditLifecycle(
  options: ReplayAuditLifecycleOptions
): Promise<ReplayAuditLifecycleResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedState = requireRunsteadStateDbSync(cwd);
  const database = openRunsteadDatabase(resolvedState.stateDb);

  try {
    const { entries, relatedIds } = collectAuditLifecycleEntriesFromDatabase(
      database,
      options.taskId
    );

    return Promise.resolve({
      root: resolvedState.root,
      stateDb: resolvedState.stateDb,
      taskId: options.taskId,
      relatedIds,
      entries
    });
  } finally {
    database.close();
  }
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

function collectAuditLifecycleEntriesFromDatabase(
  database: ReturnType<typeof openRunsteadDatabase>,
  taskId: string
): { entries: AuditLogEntry[]; relatedIds: string[] } {
  const relatedIds = new Set<string>([taskId]);
  const selectedIds = new Set<number>();
  const selectedEntries = new Map<number, AuditLogEntry>();
  let changed = true;

  while (changed) {
    changed = false;
    const entries = readAuditEntriesReferencingIds(database, relatedIds, selectedIds);

    for (const entry of entries) {
      if (!entryReferencesAnyId(entry, relatedIds)) {
        continue;
      }

      selectedIds.add(entry.id);
      selectedEntries.set(entry.id, entry);
      changed = true;
      relatedIds.add(entry.aggregateId);

      for (const id of collectReferenceIds(entry.payload)) {
        relatedIds.add(id);
      }
    }
  }

  return {
    entries: [...selectedEntries.values()].sort((left, right) => left.id - right.id),
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

function readAuditEntries(
  database: ReturnType<typeof openRunsteadDatabase>,
  options: ExportAuditLogOptions = {}
): AuditLogEntry[] {
  const clauses: string[] = [];
  const params: string[] = [];

  if (options.types !== undefined && options.types.length > 0) {
    clauses.push(`type IN (${options.types.map(() => "?").join(", ")})`);
    params.push(...options.types);
  }

  if (options.aggregateType !== undefined) {
    clauses.push("aggregate_type = ?");
    params.push(options.aggregateType);
  }

  if (options.aggregateId !== undefined) {
    clauses.push("aggregate_id = ?");
    params.push(options.aggregateId);
  }

  const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
  const rows = database
    .prepare(
      `
      SELECT id, event_id, type, aggregate_type, aggregate_id, payload_json,
             created_at
      FROM events
      ${where}
      ORDER BY id ASC
    `
    )
    .all(...params) as unknown as AuditEventRow[];

  return auditRowsToEntries(rows);
}

function readAuditEntriesReferencingIds(
  database: ReturnType<typeof openRunsteadDatabase>,
  ids: Set<string>,
  selectedIds: Set<number>
): AuditLogEntry[] {
  const referenceIds = [...ids];

  if (referenceIds.length === 0) {
    return [];
  }

  const excludedIds = [...selectedIds];
  const excludedClause =
    excludedIds.length === 0
      ? ""
      : `id NOT IN (${excludedIds.map(() => "?").join(", ")}) AND`;
  const aggregateClause = `aggregate_id IN (${referenceIds.map(() => "?").join(", ")})`;
  const payloadClauses = referenceIds
    .map(() => "payload_json LIKE ? ESCAPE '\\'")
    .join(" OR ");
  const params = [
    ...excludedIds,
    ...referenceIds,
    ...referenceIds.map((id) => `%${escapeSqlLike(id)}%`)
  ];
  const rows = database
    .prepare(
      `
      SELECT id, event_id, type, aggregate_type, aggregate_id, payload_json,
             created_at
      FROM events
      WHERE ${excludedClause} (${aggregateClause} OR ${payloadClauses})
      ORDER BY id ASC
    `
    )
    .all(...params) as unknown as AuditEventRow[];

  return auditRowsToEntries(rows);
}

function auditRowsToEntries(rows: AuditEventRow[]): AuditLogEntry[] {
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

function escapeSqlLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
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
