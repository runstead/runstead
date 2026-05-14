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
