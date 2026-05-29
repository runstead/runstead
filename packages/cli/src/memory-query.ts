import {
  MemoryRecordSchema,
  type JsonObject,
  type MemoryRecord,
  type MemoryStatus,
  type MemoryType
} from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

export interface ReadMemoryRecordsOptions {
  status?: MemoryStatus;
  scope?: string;
  type?: MemoryType;
  limit?: number;
}

export function readMemoryRecords(
  database: RunsteadDatabase,
  options: ReadMemoryRecordsOptions = {}
): MemoryRecord[] {
  const filters: string[] = [];
  const args: (number | string)[] = [];

  if (options.status !== undefined) {
    filters.push("status = ?");
    args.push(options.status);
  }

  if (options.scope !== undefined) {
    filters.push("scope = ?");
    args.push(options.scope);
  }

  if (options.type !== undefined) {
    filters.push("type = ?");
    args.push(options.type);
  }

  const rows = database
    .prepare(
      `
      SELECT id, scope, type, status, confidence, content,
             source_refs_json, provenance_json, created_at, updated_at,
             expires_at, conflicts_with_json
      FROM memory_records
      ${filters.length === 0 ? "" : `WHERE ${filters.join(" AND ")}`}
      ORDER BY created_at DESC, id ASC
      ${options.limit === undefined ? "" : "LIMIT ?"}
    `
    )
    .all(
      ...args,
      ...(options.limit === undefined ? [] : [options.limit])
    ) as unknown as MemoryRow[];

  return rows.map(rowToMemory);
}

export function readMemoryRecord(
  database: RunsteadDatabase,
  id: string
): MemoryRecord | undefined {
  const row = database
    .prepare(
      `
      SELECT id, scope, type, status, confidence, content,
             source_refs_json, provenance_json, created_at, updated_at,
             expires_at, conflicts_with_json
      FROM memory_records
      WHERE id = ?
    `
    )
    .get(id) as MemoryRow | undefined;

  return row === undefined ? undefined : rowToMemory(row);
}

export function readProjectFacts(
  database: RunsteadDatabase,
  scope: string | undefined
): MemoryRecord[] {
  const rows =
    scope === undefined
      ? (database
          .prepare(
            `
            SELECT id, scope, type, status, confidence, content,
                   source_refs_json, provenance_json, created_at, updated_at,
                   expires_at, conflicts_with_json
            FROM memory_records
            WHERE type = 'project_fact' AND status = 'verified'
            ORDER BY created_at DESC, id ASC
          `
          )
          .all() as unknown as MemoryRow[])
      : (database
          .prepare(
            `
            SELECT id, scope, type, status, confidence, content,
                   source_refs_json, provenance_json, created_at, updated_at,
                   expires_at, conflicts_with_json
            FROM memory_records
            WHERE type = 'project_fact' AND status = 'verified' AND scope = ?
            ORDER BY created_at DESC, id ASC
          `
          )
          .all(scope) as unknown as MemoryRow[]);

  return rows.map(rowToMemory);
}

export function matchesFactQuery(
  fact: MemoryRecord,
  query: string | undefined
): boolean {
  const normalized = normalizedQuery(query);

  if (normalized === null) {
    return true;
  }

  const haystack = [fact.content, ...fact.sourceRefs].join("\n").toLowerCase();

  return haystack.includes(normalized);
}

export function filterConflictedProjectFacts(input: {
  facts: MemoryRecord[];
  includeConflicted: boolean;
}): MemoryRecord[] {
  if (input.includeConflicted) {
    return input.facts;
  }

  const conflictedIds = new Set<string>();

  for (const fact of input.facts) {
    if (fact.conflictsWith.length > 0) {
      conflictedIds.add(fact.id);
    }

    for (const conflictingFactId of fact.conflictsWith) {
      conflictedIds.add(conflictingFactId);
    }
  }

  return input.facts.filter((fact) => !conflictedIds.has(fact.id));
}

export function filterExpiredProjectFacts(input: {
  facts: MemoryRecord[];
  includeExpired: boolean;
  now: Date;
}): MemoryRecord[] {
  if (input.includeExpired) {
    return input.facts;
  }

  const nowMs = input.now.getTime();

  return input.facts.filter(
    (fact) =>
      fact.expiresAt === undefined ||
      !Number.isFinite(Date.parse(fact.expiresAt)) ||
      Date.parse(fact.expiresAt) > nowMs
  );
}

export function normalizedQuery(query: string | undefined): string | null {
  const normalized = query?.trim().toLowerCase();

  return normalized === undefined || normalized.length === 0 ? null : normalized;
}

interface MemoryRow {
  id: string;
  scope: string;
  type: string;
  status: string;
  confidence: number;
  content: string;
  source_refs_json: string;
  provenance_json: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  conflicts_with_json: string;
}

function rowToMemory(row: MemoryRow): MemoryRecord {
  return MemoryRecordSchema.parse({
    id: row.id,
    scope: row.scope,
    type: row.type,
    status: row.status,
    confidence: row.confidence,
    content: row.content,
    sourceRefs: JSON.parse(row.source_refs_json) as string[],
    provenance: JSON.parse(row.provenance_json) as JsonObject,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
    conflictsWith: JSON.parse(row.conflicts_with_json) as string[]
  });
}
