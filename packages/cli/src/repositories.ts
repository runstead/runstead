import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";

import {
  createRunsteadId,
  type JsonObject,
  type RepositoryRecord,
  RepositoryRecordSchema,
  type RepositoryStatus,
  type RunsteadEvent
} from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { inspectGitHubRepository } from "./github.js";
import { inspectGitRepository } from "./repo-inspection.js";
import { requireRunsteadStateDb, requireRunsteadStateDbSync } from "./runstead-root.js";

export interface RegisterRepositoryOptions {
  cwd?: string;
  path?: string;
  alias?: string;
  remoteUrl?: string;
  defaultBranch?: string;
  tags?: string[];
  now?: Date;
}

export interface RegisterRepositoryResult {
  repository: RepositoryRecord;
  event: RunsteadEvent;
  stateDb: string;
  created: boolean;
}

export interface ListRepositoriesOptions {
  cwd?: string;
  status?: RepositoryStatus;
}

export interface ListRepositoriesResult {
  repositories: RepositoryRecord[];
  stateDb: string;
}

export interface ShowRepositoryOptions {
  cwd?: string;
  ref: string;
}

export interface ShowRepositoryResult {
  repository: RepositoryRecord;
  stateDb: string;
}

export async function registerRepository(
  options: RegisterRepositoryOptions = {}
): Promise<RegisterRepositoryResult> {
  const controlCwd = resolve(options.cwd ?? process.cwd());
  const stateDb = (await requireRunsteadStateDb(controlCwd)).stateDb;
  const requestedPath = resolve(controlCwd, options.path ?? ".");
  const git = await inspectGitRepository(requestedPath);
  const localPath = git.root ?? (await normalizePath(requestedPath));
  const database = openRunsteadDatabase(stateDb);

  try {
    const existingByPath = findRepositoryByLocalPath(database, localPath);
    const shouldInspectGitHub =
      options.remoteUrl === undefined &&
      (options.alias === undefined || existingByPath === undefined);
    const github = shouldInspectGitHub
      ? await inspectGitHubRepository({ cwd: localPath })
      : undefined;
    const alias = normalizeAlias(
      options.alias ?? existingByPath?.alias ?? defaultAlias(localPath, github)
    );
    const existingByAlias = findRepositoryByAlias(database, alias);

    if (
      existingByAlias !== undefined &&
      existingByPath !== undefined &&
      existingByAlias.id !== existingByPath.id
    ) {
      throw new Error(
        `Repository alias ${alias} and path ${localPath} belong to different records`
      );
    }

    if (
      existingByAlias !== undefined &&
      existingByPath === undefined &&
      existingByAlias.localPath !== localPath
    ) {
      throw new Error(
        `Repository alias ${alias} already points to ${existingByAlias.localPath}`
      );
    }

    const existing = existingByPath ?? existingByAlias;
    const now = options.now ?? new Date();
    const updatedAt = now.toISOString();
    const remoteUrl = options.remoteUrl ?? github?.remoteUrl;
    const defaultBranch = options.defaultBranch ?? git.branch;
    const repository: RepositoryRecord = RepositoryRecordSchema.parse({
      id: existing?.id ?? createRunsteadId("repo"),
      alias,
      localPath,
      ...(remoteUrl === undefined ? {} : { remoteUrl }),
      ...(defaultBranch === undefined ? {} : { defaultBranch }),
      status: "active",
      tags: normalizeTags(options.tags ?? existing?.tags ?? []),
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt
    });
    const created = existing === undefined;
    const event: RunsteadEvent = {
      eventId: createRunsteadId("evt"),
      type: created ? "repository.registered" : "repository.updated",
      aggregateType: "repository",
      aggregateId: repository.id,
      payload: repositoryPayload(repository),
      createdAt: updatedAt
    };

    appendEventAndProject(database, {
      event,
      projection: {
        type: "repository",
        value: repository
      }
    });

    return {
      repository,
      event,
      stateDb,
      created
    };
  } finally {
    database.close();
  }
}

export function listRepositories(
  options: ListRepositoriesOptions = {}
): ListRepositoriesResult {
  const stateDb = resolveStateDb(options.cwd);
  const database = openRunsteadDatabase(stateDb);

  try {
    const rows =
      options.status === undefined
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
            .all(options.status) as unknown as RepositoryRow[]);

    return {
      repositories: rows.map(rowToRepository),
      stateDb
    };
  } finally {
    database.close();
  }
}

export function showRepository(options: ShowRepositoryOptions): ShowRepositoryResult {
  const stateDb = resolveStateDb(options.cwd);
  const database = openRunsteadDatabase(stateDb);

  try {
    const repository = resolveRepositoryFromDatabase(
      database,
      options.ref,
      options.cwd
    );

    if (repository === undefined) {
      throw new Error(`Repository not found: ${options.ref}`);
    }

    return {
      repository,
      stateDb
    };
  } finally {
    database.close();
  }
}

export function resolveRepositoryReference(
  options: ShowRepositoryOptions
): ShowRepositoryResult {
  return showRepository(options);
}

function resolveStateDb(cwd = process.cwd()): string {
  return requireRunsteadStateDbSync(cwd).stateDb;
}

async function normalizePath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function normalizeAlias(alias: string): string {
  const normalized = alias.trim();

  if (normalized.length === 0) {
    throw new Error("Repository alias cannot be empty");
  }

  return normalized;
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort();
}

function defaultAlias(
  localPath: string,
  github: Awaited<ReturnType<typeof inspectGitHubRepository>> | undefined
): string {
  if (github?.repository !== undefined) {
    return `${github.repository.owner}/${github.repository.repo}`;
  }

  return basename(localPath);
}

function repositoryPayload(repository: RepositoryRecord): JsonObject {
  return {
    alias: repository.alias,
    localPath: repository.localPath,
    ...(repository.remoteUrl === undefined ? {} : { remoteUrl: repository.remoteUrl }),
    ...(repository.defaultBranch === undefined
      ? {}
      : { defaultBranch: repository.defaultBranch }),
    status: repository.status,
    tags: repository.tags
  };
}

function findRepositoryByAlias(
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

function findRepositoryByLocalPath(
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

function resolveRepositoryFromDatabase(
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

interface RepositoryRow {
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

function rowToRepository(row: RepositoryRow): RepositoryRecord {
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
