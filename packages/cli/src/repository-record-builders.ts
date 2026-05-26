import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type { JsonObject, RepositoryRecord } from "@runstead/core";

export interface RepositoryName {
  owner: string;
  repo: string;
}

export async function normalizeRepositoryPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

export function normalizeRepositoryAlias(alias: string): string {
  const normalized = alias.trim();

  if (normalized.length === 0) {
    throw new Error("Repository alias cannot be empty");
  }

  return normalized;
}

export function normalizeRepositoryTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort();
}

export function defaultRepositoryAlias(
  localPath: string,
  repository: RepositoryName | undefined
): string {
  if (repository !== undefined) {
    return `${repository.owner}/${repository.repo}`;
  }

  return basename(localPath);
}

export function repositoryPayload(repository: RepositoryRecord): JsonObject {
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
