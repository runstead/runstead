import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createSchemaSql } from "./schema.js";

export type RunsteadDatabase = DatabaseSync;

export function openRunsteadDatabase(path: string): RunsteadDatabase {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const database = new DatabaseSync(path, {
    enableForeignKeyConstraints: true,
    timeout: 5000
  });

  configureRunsteadDatabase(database);
  migrateRunsteadDatabase(database);

  return database;
}

export function configureRunsteadDatabase(database: RunsteadDatabase): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
  `);
}

export function migrateRunsteadDatabase(database: RunsteadDatabase): void {
  database.exec(createSchemaSql);
}

export * from "./projections.js";
export { createSchemaSql };
