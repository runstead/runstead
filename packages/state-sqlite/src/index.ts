import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  REQUIRED_STATE_INDEXES,
  REQUIRED_STATE_TABLES,
  RUNSTEAD_SCHEMA_VERSION,
  createSchemaSql,
  runsteadSchemaMigrations,
  schemaMigrationsTableSql
} from "./schema.js";

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
  database.exec("BEGIN IMMEDIATE");

  try {
    database.exec(schemaMigrationsTableSql);
    const applied = appliedMigrations(database);
    const currentVersion = applied.at(-1)?.version ?? 0;

    if (currentVersion > RUNSTEAD_SCHEMA_VERSION) {
      throw new Error(
        `Runstead state schema version ${currentVersion} is newer than supported version ${RUNSTEAD_SCHEMA_VERSION}`
      );
    }

    for (const migration of runsteadSchemaMigrations) {
      const checksum = migrationChecksum(migration.sql);
      const existing = applied.find((item) => item.version === migration.version);

      if (existing !== undefined) {
        if (existing.checksum !== checksum) {
          throw new Error(
            `Runstead schema migration ${migration.version} checksum mismatch`
          );
        }

        continue;
      }

      if (migration.version <= currentVersion) {
        throw new Error(
          `Runstead schema migration ${migration.version} is missing below current version ${currentVersion}`
        );
      }

      database.exec(migration.sql);
      database
        .prepare(
          `
          INSERT INTO schema_migrations (version, name, checksum, applied_at)
          VALUES (?, ?, ?, ?)
        `
        )
        .run(migration.version, migration.name, checksum, new Date().toISOString());
    }

    database.exec(`PRAGMA user_version = ${RUNSTEAD_SCHEMA_VERSION}`);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export * from "./projections.js";
export * from "./schema-validation.js";
export * from "./database-identity.js";
export {
  REQUIRED_STATE_INDEXES,
  REQUIRED_STATE_TABLES,
  RUNSTEAD_SCHEMA_VERSION,
  createSchemaSql,
  runsteadSchemaMigrations
};

interface AppliedMigrationRow {
  version: number;
  checksum: string;
}

function appliedMigrations(database: RunsteadDatabase): AppliedMigrationRow[] {
  return database
    .prepare(
      `
      SELECT version, checksum
      FROM schema_migrations
      ORDER BY version ASC
    `
    )
    .all() as unknown as AppliedMigrationRow[];
}

function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}
