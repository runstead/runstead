import { stat } from "node:fs/promises";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

import type { StartupCompleteProductEvidenceRow } from "./startup-complete-check-criteria.js";

interface EventCountRow {
  count: number;
}

export function readStartupCompleteProductEvidenceRows(
  stateDb: string
): StartupCompleteProductEvidenceRow[] {
  const database = openRunsteadDatabase(stateDb);

  try {
    return database
      .prepare(
        `
        SELECT id, type, uri, summary, created_at
        FROM evidence
        WHERE type = 'command_output' OR type LIKE 'startup_%'
        ORDER BY created_at DESC, id ASC
      `
      )
      .all() as unknown as StartupCompleteProductEvidenceRow[];
  } finally {
    database.close();
  }
}

export function readStartupCompleteProductEventCount(stateDb: string): number {
  const database = openRunsteadDatabase(stateDb);

  try {
    const row = database
      .prepare("SELECT COUNT(*) AS count FROM events")
      .get() as unknown as EventCountRow;

    return row.count;
  } finally {
    database.close();
  }
}

export async function existingStartupCompleteProductPathState(
  paths: string[]
): Promise<Map<string, boolean>> {
  const results = await Promise.all(
    paths.map(async (path) => [path, await pathExists(path)] as const)
  );

  return new Map(results);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    const result = await stat(path);

    return result.isFile();
  } catch {
    return false;
  }
}
