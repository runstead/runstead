import type { openRunsteadDatabase } from "@runstead/state-sqlite";

import type { AuditLogEntry, ExportAuditLogOptions } from "./audit-export-types.js";

interface AuditEventRow {
  id: number;
  event_id: string;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload_json: string;
  created_at: string;
}

export function readAuditEntries(
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

export function readAuditEntriesReferencingIds(
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
