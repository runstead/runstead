import { resolve } from "node:path";

import {
  boundedMaxResults,
  matchesAnyPattern,
  matchesListInclude,
  normalizePatterns,
  safeWorkspaceTarget,
  workspaceRelativePath
} from "./codex-direct-workspace-paths.js";
import {
  direntType,
  sortedDirents,
  type ListWorkspaceFileEntry
} from "./codex-direct-workspace-entries.js";

const DEFAULT_IGNORED_DIRECTORIES = [".git", "node_modules", "dist", ".runstead"];
const DEFAULT_LIST_FILES_MAX_RESULTS = 200;
const LIST_FILES_MAX_RESULTS_LIMIT = 1_000;
const DEFAULT_TREE_MAX_DEPTH = 3;
const TREE_MAX_DEPTH_LIMIT = 8;
const DEFAULT_TREE_MAX_ENTRIES = 200;
const TREE_MAX_ENTRIES_LIMIT = 1_000;

export interface ListWorkspaceFilesOptions {
  glob?: string[];
  exclude?: string[];
  maxResults?: number;
  includeDirs?: boolean;
}

export interface ListWorkspaceFilesResult {
  cwd: string;
  entries: ListWorkspaceFileEntry[];
  truncated: boolean;
  maxResults: number;
}

export interface WorkspaceTreeOptions {
  path?: string;
  maxDepth?: number;
  maxEntries?: number;
  includeFiles?: boolean;
}

export interface WorkspaceTreeEntry extends ListWorkspaceFileEntry {
  depth: number;
}

export interface WorkspaceTreeResult {
  cwd: string;
  path: string;
  entries: WorkspaceTreeEntry[];
  truncated: boolean;
  maxDepth: number;
  maxEntries: number;
}

export async function listWorkspaceFiles(
  cwd: string,
  options: ListWorkspaceFilesOptions = {}
): Promise<ListWorkspaceFilesResult> {
  const root = resolve(cwd);
  const maxResults = boundedMaxResults(
    options.maxResults,
    DEFAULT_LIST_FILES_MAX_RESULTS,
    LIST_FILES_MAX_RESULTS_LIMIT
  );
  const includeDirs = options.includeDirs === true;
  const includes = normalizePatterns(options.glob);
  const excludes = normalizePatterns(options.exclude);
  const entries: ListWorkspaceFileEntry[] = [];
  let truncated = false;

  async function walk(directory: string): Promise<void> {
    if (truncated) {
      return;
    }

    const sorted = await sortedDirents(directory);

    for (const dirent of sorted) {
      if (truncated) {
        return;
      }

      const absolutePath = resolve(directory, dirent.name);
      const relativePath = workspaceRelativePath(root, absolutePath);
      const entryType = direntType(dirent);

      if (dirent.isDirectory() && DEFAULT_IGNORED_DIRECTORIES.includes(dirent.name)) {
        continue;
      }

      if (matchesAnyPattern(relativePath, excludes)) {
        continue;
      }

      if (
        (entryType !== "directory" || includeDirs) &&
        matchesListInclude(relativePath, includes)
      ) {
        entries.push({
          path: relativePath,
          type: entryType
        });

        if (entries.length > maxResults) {
          truncated = true;
          entries.length = maxResults;
          return;
        }
      }

      if (dirent.isDirectory()) {
        await walk(absolutePath);
      }
    }
  }

  await walk(root);

  return {
    cwd: root,
    entries,
    truncated,
    maxResults
  };
}

export async function workspaceTree(
  cwd: string,
  options: WorkspaceTreeOptions = {}
): Promise<WorkspaceTreeResult> {
  const root = resolve(cwd);
  const target = await safeWorkspaceTarget(root, options.path ?? ".", {
    allowRoot: true
  });
  const maxDepth = Math.min(
    options.maxDepth ?? DEFAULT_TREE_MAX_DEPTH,
    TREE_MAX_DEPTH_LIMIT
  );
  const maxEntries = boundedMaxResults(
    options.maxEntries,
    DEFAULT_TREE_MAX_ENTRIES,
    TREE_MAX_ENTRIES_LIMIT
  );
  const includeFiles = options.includeFiles !== false;
  const entries: WorkspaceTreeEntry[] = [];
  let truncated = false;

  async function walk(directory: string, depth: number): Promise<void> {
    if (truncated || depth > maxDepth) {
      return;
    }

    const dirents = await sortedDirents(directory);

    for (const dirent of dirents) {
      if (truncated) {
        return;
      }

      if (dirent.isDirectory() && DEFAULT_IGNORED_DIRECTORIES.includes(dirent.name)) {
        continue;
      }

      const absolutePath = resolve(directory, dirent.name);
      const relativePath = workspaceRelativePath(root, absolutePath);
      const type = direntType(dirent);

      if (includeFiles || type === "directory") {
        entries.push({
          path: relativePath,
          type,
          depth
        });

        if (entries.length >= maxEntries) {
          truncated = true;
          return;
        }
      }

      if (dirent.isDirectory()) {
        await walk(absolutePath, depth + 1);
      }
    }
  }

  await walk(target.absolutePath, 1);

  return {
    cwd: root,
    path: target.relativePath,
    entries,
    truncated,
    maxDepth,
    maxEntries
  };
}
