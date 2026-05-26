import { resolve } from "node:path";

import {
  type RepositoryRecord,
  RepositoryRecordSchema,
  type RepositoryStatus
} from "@runstead/core";
import { type openRunsteadDatabase } from "@runstead/state-sqlite";

export interface RepositoryRow {
  id: string;
  alias: string;
  local_path: string;
  remote_url: string | null;
  default_branch: string | null;
  status: string;
  tags_json: string;
  created_at: string;
  updated_at: string;
}

export function findRepositoryByAlias(
  database: ReturnType<typeof openRunsteadDatabase>,
  alias: string
): RepositoryRecord | undefined {
  const row = database
    .prepare(
      `
      SELECT id, alias, local_path, remote_url, default_branch, status,
             tags_json, created_at, updated_at
      FROM repositories
      WHERE alias = ?
    `
    )
    .get(alias) as RepositoryRow | undefined;

  return row === undefined ? undefined : rowToRepository(row);
}

export function findRepositoryByLocalPath(
  database: ReturnType<typeof openRunsteadDatabase>,
  localPath: string
): RepositoryRecord | undefined {
  const row = database
    .prepare(
      `
      SELECT id, alias, local_path, remote_url, default_branch, status,
             tags_json, created_at, updated_at
      FROM repositories
      WHERE local_path = ?
    `
    )
    .get(localPath) as RepositoryRow | undefined;

  return row === undefined ? undefined : rowToRepository(row);
}

export function resolveRepositoryFromDatabase(
  database: ReturnType<typeof openRunsteadDatabase>,
  ref: string,
  cwd = process.cwd()
): RepositoryRecord | undefined {
  const candidates = [...new Set([ref, resolve(cwd, ref)])];

  for (const candidate of candidates) {
    const row = database
      .prepare(
        `
        SELECT id, alias, local_path, remote_url, default_branch, status,
               tags_json, created_at, updated_at
        FROM repositories
        WHERE id = ? OR alias = ? OR local_path = ?
      `
      )
      .get(candidate, candidate, candidate) as RepositoryRow | undefined;

    if (row !== undefined) {
      return rowToRepository(row);
    }
  }

  return undefined;
}

export function listRepositoriesFromDatabase(
  database: ReturnType<typeof openRunsteadDatabase>,
  status?: RepositoryStatus
): RepositoryRecord[] {
  const rows =
    status === undefined
      ? (database
          .prepare(
            `
            SELECT id, alias, local_path, remote_url, default_branch, status,
                   tags_json, created_at, updated_at
            FROM repositories
            ORDER BY alias ASC, id ASC
          `
          )
          .all() as unknown as RepositoryRow[])
      : (database
          .prepare(
            `
            SELECT id, alias, local_path, remote_url, default_branch, status,
                   tags_json, created_at, updated_at
            FROM repositories
            WHERE status = ?
            ORDER BY alias ASC, id ASC
          `
          )
          .all(status) as unknown as RepositoryRow[]);

  return rows.map(rowToRepository);
}

export function rowToRepository(row: RepositoryRow): RepositoryRecord {
  return RepositoryRecordSchema.parse({
    id: row.id,
    alias: row.alias,
    localPath: row.local_path,
    ...(row.remote_url === null ? {} : { remoteUrl: row.remote_url }),
    ...(row.default_branch === null ? {} : { defaultBranch: row.default_branch }),
    status: row.status,
    tags: JSON.parse(row.tags_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}
