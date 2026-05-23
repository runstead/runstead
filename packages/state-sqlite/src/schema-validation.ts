import { createHash } from "node:crypto";

import type { RunsteadDatabase } from "./index.js";
import {
  REQUIRED_STATE_INDEXES,
  REQUIRED_STATE_TABLES,
  RUNSTEAD_SCHEMA_VERSION,
  runsteadSchemaMigrations
} from "./schema.js";

export interface RunsteadSchemaValidation {
  ok: boolean;
  expectedVersion: number;
  appliedVersion: number;
  userVersion: number;
  missingTables: string[];
  missingIndexes: string[];
  missingMigrations: number[];
  futureMigrations: number[];
  checksumMismatches: number[];
}

export function validateRunsteadDatabaseSchema(
  database: RunsteadDatabase
): RunsteadSchemaValidation {
  const tableNames = sqliteObjectNames(database, "table");
  const indexNames = sqliteObjectNames(database, "index");
  const missingTables = REQUIRED_STATE_TABLES.filter(
    (table) => !tableNames.includes(table)
  );
  const missingIndexes = REQUIRED_STATE_INDEXES.filter(
    (index) => !indexNames.includes(index)
  );
  const appliedMigrations = tableNames.includes("schema_migrations")
    ? readAppliedMigrations(database)
    : [];
  const appliedVersions = appliedMigrations.map((migration) => migration.version);
  const expectedVersions = runsteadSchemaMigrations.map(
    (migration) => migration.version
  );
  const expectedChecksums = new Map(
    runsteadSchemaMigrations.map((migration) => [
      migration.version,
      migrationChecksum(migration.sql)
    ])
  );
  const missingMigrations = expectedVersions.filter(
    (version) => !appliedVersions.includes(version)
  );
  const futureMigrations = appliedVersions.filter(
    (version) => version > RUNSTEAD_SCHEMA_VERSION
  );
  const checksumMismatches = appliedMigrations
    .filter((migration) => {
      const expectedChecksum = expectedChecksums.get(migration.version);

      return expectedChecksum !== undefined && expectedChecksum !== migration.checksum;
    })
    .map((migration) => migration.version);
  const userVersion = readUserVersion(database);
  const appliedVersion =
    appliedVersions.length === 0 ? 0 : Math.max(...appliedVersions);

  return {
    ok:
      missingTables.length === 0 &&
      missingIndexes.length === 0 &&
      missingMigrations.length === 0 &&
      futureMigrations.length === 0 &&
      checksumMismatches.length === 0 &&
      appliedVersion === RUNSTEAD_SCHEMA_VERSION &&
      userVersion === RUNSTEAD_SCHEMA_VERSION,
    expectedVersion: RUNSTEAD_SCHEMA_VERSION,
    appliedVersion,
    userVersion,
    missingTables,
    missingIndexes,
    missingMigrations,
    futureMigrations,
    checksumMismatches
  };
}

export function formatRunsteadSchemaValidation(
  validation: RunsteadSchemaValidation
): string {
  if (validation.missingTables.length > 0) {
    return `missing tables: ${validation.missingTables.join(", ")}`;
  }

  const issues = [
    ...(validation.missingMigrations.length === 0
      ? []
      : [`missing migrations: ${validation.missingMigrations.join(", ")}`]),
    ...(validation.futureMigrations.length === 0
      ? []
      : [`unsupported future migrations: ${validation.futureMigrations.join(", ")}`]),
    ...(validation.checksumMismatches.length === 0
      ? []
      : [`migration checksum mismatch: ${validation.checksumMismatches.join(", ")}`]),
    ...(validation.missingIndexes.length === 0
      ? []
      : [`missing indexes: ${validation.missingIndexes.join(", ")}`]),
    ...(validation.appliedVersion === validation.expectedVersion
      ? []
      : [
          `schema version ${validation.appliedVersion}, expected ${validation.expectedVersion}`
        ]),
    ...(validation.userVersion === validation.expectedVersion
      ? []
      : [
          `sqlite user_version ${validation.userVersion}, expected ${validation.expectedVersion}`
        ])
  ];

  return issues.length === 0
    ? `schema version ${validation.expectedVersion}`
    : issues.join("; ");
}

interface AppliedMigrationRow {
  version: number;
  checksum: string;
}

function sqliteObjectNames(
  database: RunsteadDatabase,
  type: "index" | "table"
): string[] {
  const rows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = ?")
    .all(type) as { name: string }[];

  return rows.map((row) => row.name);
}

function readAppliedMigrations(database: RunsteadDatabase): AppliedMigrationRow[] {
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

function readUserVersion(database: RunsteadDatabase): number {
  const row = database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };

  return row.user_version;
}

function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}
