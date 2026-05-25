import type { Dirent, Stats } from "node:fs";
import { readFile, readdir } from "node:fs/promises";

import { boundedMaxResults, normalizePath } from "./codex-direct-workspace-paths.js";

const DEFAULT_FILE_INFO_MAX_ENTRIES = 100;
const FILE_INFO_MAX_ENTRIES_LIMIT = 500;
const BINARY_SAMPLE_BYTES = 8192;

export interface ListWorkspaceFileEntry {
  path: string;
  type: "file" | "directory" | "symlink" | "other";
}

export interface WorkspaceDirectorySummary {
  entries: ListWorkspaceFileEntry[];
  counts: {
    files: number;
    directories: number;
    symlinks: number;
    other: number;
  };
  truncated: boolean;
  maxEntries: number;
}

export function direntType(dirent: Dirent): ListWorkspaceFileEntry["type"] {
  if (dirent.isFile()) {
    return "file";
  }

  if (dirent.isDirectory()) {
    return "directory";
  }

  if (dirent.isSymbolicLink()) {
    return "symlink";
  }

  return "other";
}

export function statsToEntryType(stats: Stats): ListWorkspaceFileEntry["type"] {
  if (stats.isFile()) {
    return "file";
  }

  if (stats.isDirectory()) {
    return "directory";
  }

  if (stats.isSymbolicLink()) {
    return "symlink";
  }

  return "other";
}

export async function summarizeDirectory(
  directory: string,
  relativeDirectory: string,
  options: { maxEntries?: number }
): Promise<WorkspaceDirectorySummary> {
  const maxEntries = boundedMaxResults(
    options.maxEntries,
    DEFAULT_FILE_INFO_MAX_ENTRIES,
    FILE_INFO_MAX_ENTRIES_LIMIT
  );
  const dirents = await sortedDirents(directory);
  const counts = {
    files: 0,
    directories: 0,
    symlinks: 0,
    other: 0
  };
  const entries: ListWorkspaceFileEntry[] = [];

  for (const dirent of dirents) {
    const type = direntType(dirent);

    switch (type) {
      case "file":
        counts.files += 1;
        break;
      case "directory":
        counts.directories += 1;
        break;
      case "symlink":
        counts.symlinks += 1;
        break;
      case "other":
        counts.other += 1;
        break;
    }

    if (entries.length < maxEntries) {
      entries.push({
        path: normalizePath(`${relativeDirectory}/${dirent.name}`),
        type
      });
    }
  }

  return {
    entries,
    counts,
    truncated: dirents.length > maxEntries,
    maxEntries
  };
}

export async function sortedDirents(directory: string): Promise<Dirent[]> {
  const dirents = await readdir(directory, { withFileTypes: true });

  return dirents.toSorted((left, right) => left.name.localeCompare(right.name));
}

export async function isBinaryFile(path: string): Promise<boolean> {
  const sample = (await readFile(path)).subarray(0, BINARY_SAMPLE_BYTES);

  return sample.includes(0);
}
