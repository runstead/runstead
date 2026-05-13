import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { resolveRunsteadRootSync } from "./runstead-root.js";

export interface ExportAuditLogOptions {
  cwd?: string;
  outputPath?: string;
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
  const resolvedRoot = resolveRunsteadRootSync(cwd);

  if (resolvedRoot.source === "missing") {
    throw new Error(`Runstead is not initialized at ${resolvedRoot.root}`);
  }

  const stateDb = join(resolvedRoot.root, "state.db");
  const database = openRunsteadDatabase(stateDb);

  try {
    const entries = readAuditEntries(database);
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
      root: resolvedRoot.root,
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
