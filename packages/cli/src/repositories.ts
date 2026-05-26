import { resolve } from "node:path";

import {
  createRunsteadId,
  type RepositoryRecord,
  RepositoryRecordSchema,
  type RepositoryStatus,
  type RunsteadEvent
} from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { inspectGitHubRepository } from "./github.js";
import { inspectGitRepository } from "./repo-inspection.js";
import {
  findRepositoryByAlias,
  findRepositoryByLocalPath,
  listRepositoriesFromDatabase,
  resolveRepositoryFromDatabase
} from "./repositories-store.js";
import {
  defaultRepositoryAlias,
  normalizeRepositoryAlias,
  normalizeRepositoryPath,
  normalizeRepositoryTags,
  repositoryPayload
} from "./repository-record-builders.js";
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

export interface ArchiveRepositoryOptions {
  cwd?: string;
  ref: string;
  now?: Date;
}

export interface ArchiveRepositoryResult {
  repository: RepositoryRecord;
  event: RunsteadEvent;
  stateDb: string;
  previousStatus: RepositoryStatus;
}

export async function registerRepository(
  options: RegisterRepositoryOptions = {}
): Promise<RegisterRepositoryResult> {
  const controlCwd = resolve(options.cwd ?? process.cwd());
  const stateDb = (await requireRunsteadStateDb(controlCwd)).stateDb;
  const requestedPath = resolve(controlCwd, options.path ?? ".");
  const git = await inspectGitRepository(requestedPath);
  const localPath = git.root ?? (await normalizeRepositoryPath(requestedPath));
  const database = openRunsteadDatabase(stateDb);

  try {
    const existingByPath = findRepositoryByLocalPath(database, localPath);
    const shouldInspectGitHub =
      options.remoteUrl === undefined &&
      (options.alias === undefined || existingByPath === undefined);
    const github = shouldInspectGitHub
      ? await inspectGitHubRepository({ cwd: localPath })
      : undefined;
    const alias = normalizeRepositoryAlias(
      options.alias ??
        existingByPath?.alias ??
        defaultRepositoryAlias(localPath, github?.repository)
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
      tags: normalizeRepositoryTags(options.tags ?? existing?.tags ?? []),
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
    return {
      repositories: listRepositoriesFromDatabase(database, options.status),
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

export function archiveRepository(
  options: ArchiveRepositoryOptions
): ArchiveRepositoryResult {
  const stateDb = resolveStateDb(options.cwd);
  const database = openRunsteadDatabase(stateDb);

  try {
    const current = resolveRepositoryFromDatabase(database, options.ref, options.cwd);

    if (current === undefined) {
      throw new Error(`Repository not found: ${options.ref}`);
    }

    const archivedAt = (options.now ?? new Date()).toISOString();
    const repository: RepositoryRecord = {
      ...current,
      status: "archived",
      updatedAt: archivedAt
    };
    const event: RunsteadEvent = {
      eventId: createRunsteadId("evt"),
      type: "repository.archived",
      aggregateType: "repository",
      aggregateId: repository.id,
      payload: {
        ...repositoryPayload(repository),
        previousStatus: current.status
      },
      createdAt: archivedAt
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
      previousStatus: current.status
    };
  } finally {
    database.close();
  }
}

function resolveStateDb(cwd = process.cwd()): string {
  return requireRunsteadStateDbSync(cwd).stateDb;
}
