import { realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import type { RunsteadDatabase } from "./index.js";

export function readRunsteadDatabasePath(
  database: RunsteadDatabase
): string | undefined {
  const rows = database.prepare("PRAGMA database_list").all() as {
    name: string;
    file: string | null;
  }[];
  const main = rows.find((row) => row.name === "main");

  if (main?.file === undefined || main.file === null || main.file.length === 0) {
    return undefined;
  }

  return canonicalPath(main.file);
}

export function assertRunsteadDatabasePath(
  database: RunsteadDatabase,
  expectedPath: string
): void {
  if (expectedPath === ":memory:") {
    return;
  }

  const actualPath = readRunsteadDatabasePath(database);
  const resolvedExpected = canonicalPath(expectedPath);

  if (actualPath === undefined) {
    throw new Error(
      `Runstead database identity is unavailable; expected ${resolvedExpected}`
    );
  }

  if (actualPath !== resolvedExpected) {
    throw new Error(
      `Runstead database mismatch: expected ${resolvedExpected}, got ${actualPath}`
    );
  }
}

function canonicalPath(path: string): string {
  const resolved = resolve(path);

  try {
    return realpathSync.native(resolved);
  } catch {
    try {
      return resolve(realpathSync.native(dirname(resolved)), basename(resolved));
    } catch {
      return resolved;
    }
  }
}
