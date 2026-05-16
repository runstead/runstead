import type { Dirent } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const DEFAULT_IGNORED_DIRECTORIES = [".git", "node_modules", "dist", ".runstead"];
const DEFAULT_LIST_FILES_MAX_RESULTS = 200;
const LIST_FILES_MAX_RESULTS_LIMIT = 1_000;
const DEFAULT_SEARCH_TEXT_MAX_MATCHES = 100;
const SEARCH_TEXT_MAX_MATCHES_LIMIT = 500;
const SEARCH_TEXT_FILE_SCAN_LIMIT = 1_000;
const SEARCH_TEXT_CONTEXT_LIMIT = 5;
const SEARCH_TEXT_PREVIEW_LIMIT = 500;
const DEFAULT_READ_MANY_BYTES_PER_FILE = 64 * 1024;
const READ_MANY_BYTES_PER_FILE_LIMIT = 1024 * 1024;
const DEFAULT_READ_MANY_TOTAL_BYTES = 256 * 1024;
const READ_MANY_TOTAL_BYTES_LIMIT = 2 * 1024 * 1024;
const DEFAULT_FILE_INFO_MAX_ENTRIES = 100;
const FILE_INFO_MAX_ENTRIES_LIMIT = 500;
const BINARY_SAMPLE_BYTES = 8192;
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

export interface ListWorkspaceFileEntry {
  path: string;
  type: "file" | "directory" | "symlink" | "other";
}

export interface ListWorkspaceFilesResult {
  cwd: string;
  entries: ListWorkspaceFileEntry[];
  truncated: boolean;
  maxResults: number;
}

export interface SearchWorkspaceTextOptions {
  query: string;
  regex?: boolean;
  glob?: string[];
  caseSensitive?: boolean;
  contextLines?: number;
  maxMatches?: number;
}

export interface SearchWorkspaceTextContextLine {
  line: number;
  text: string;
}

export interface SearchWorkspaceTextMatch {
  path: string;
  line: number;
  preview: string;
  before?: SearchWorkspaceTextContextLine[];
  after?: SearchWorkspaceTextContextLine[];
}

export interface SearchWorkspaceTextResult {
  cwd: string;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  matches: SearchWorkspaceTextMatch[];
  truncated: boolean;
  maxMatches: number;
  filesSearched: number;
  filesTruncated: boolean;
}

export interface ReadManyWorkspaceFilesOptions {
  paths: string[];
  maxBytesPerFile?: number;
  maxTotalBytes?: number;
}

export interface ReadManyWorkspaceFile {
  path: string;
  content: string;
  bytes: number;
  returnedBytes: number;
  truncated: boolean;
}

export interface ReadManyWorkspaceFilesResult {
  cwd: string;
  files: ReadManyWorkspaceFile[];
  bytes: number;
  returnedBytes: number;
  truncated: boolean;
  maxBytesPerFile: number;
  maxTotalBytes: number;
}

export interface WorkspaceFileInfoOptions {
  path: string;
  maxEntries?: number;
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

export interface WorkspaceFileInfoResult {
  cwd: string;
  path: string;
  type: ListWorkspaceFileEntry["type"];
  bytes: number;
  mtimeMs: number;
  mtime: string;
  binary?: boolean;
  directory?: WorkspaceDirectorySummary;
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

export async function inspectWorkspacePath(
  cwd: string,
  options: WorkspaceFileInfoOptions
): Promise<WorkspaceFileInfoResult> {
  const root = resolve(cwd);
  const target = workspaceTarget(root, options.path, { allowRoot: true });
  const stats = await lstat(target.absolutePath);
  const type = statsToEntryType(stats);
  const result: WorkspaceFileInfoResult = {
    cwd: root,
    path: target.relativePath,
    type,
    bytes: stats.size,
    mtimeMs: stats.mtimeMs,
    mtime: stats.mtime.toISOString()
  };

  if (type === "file") {
    result.binary = await isBinaryFile(target.absolutePath);
  }

  if (type === "directory") {
    result.directory = await summarizeDirectory(
      target.absolutePath,
      target.relativePath,
      {
        maxEntries: options.maxEntries
      }
    );
  }

  return result;
}

export async function workspaceTree(
  cwd: string,
  options: WorkspaceTreeOptions = {}
): Promise<WorkspaceTreeResult> {
  const root = resolve(cwd);
  const target = workspaceTarget(root, options.path ?? ".", { allowRoot: true });
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

export async function readManyWorkspaceFiles(
  cwd: string,
  options: ReadManyWorkspaceFilesOptions
): Promise<ReadManyWorkspaceFilesResult> {
  const root = resolve(cwd);
  const maxBytesPerFile = boundedMaxResults(
    options.maxBytesPerFile,
    DEFAULT_READ_MANY_BYTES_PER_FILE,
    READ_MANY_BYTES_PER_FILE_LIMIT
  );
  const maxTotalBytes = boundedMaxResults(
    options.maxTotalBytes,
    DEFAULT_READ_MANY_TOTAL_BYTES,
    READ_MANY_TOTAL_BYTES_LIMIT
  );
  const files: ReadManyWorkspaceFile[] = [];
  let bytes = 0;
  let returnedBytes = 0;

  for (const requestedPath of options.paths) {
    const target = workspaceTarget(root, requestedPath);
    const buffer = await readFile(target.absolutePath);
    const fileBytes = buffer.byteLength;
    const remainingTotalBytes = Math.max(0, maxTotalBytes - returnedBytes);
    const fileReturnedBytes = Math.min(fileBytes, maxBytesPerFile, remainingTotalBytes);
    const content = buffer.subarray(0, fileReturnedBytes).toString("utf8");
    const truncated = fileReturnedBytes < fileBytes;

    bytes += fileBytes;
    returnedBytes += Buffer.byteLength(content, "utf8");
    files.push({
      path: target.relativePath,
      content,
      bytes: fileBytes,
      returnedBytes: Buffer.byteLength(content, "utf8"),
      truncated
    });
  }

  return {
    cwd: root,
    files,
    bytes,
    returnedBytes,
    truncated: files.some((file) => file.truncated),
    maxBytesPerFile,
    maxTotalBytes
  };
}

export async function searchWorkspaceText(
  cwd: string,
  options: SearchWorkspaceTextOptions
): Promise<SearchWorkspaceTextResult> {
  const root = resolve(cwd);
  const maxMatches = boundedMaxResults(
    options.maxMatches,
    DEFAULT_SEARCH_TEXT_MAX_MATCHES,
    SEARCH_TEXT_MAX_MATCHES_LIMIT
  );
  const contextLines = Math.min(options.contextLines ?? 0, SEARCH_TEXT_CONTEXT_LIMIT);
  const regex = options.regex === true;
  const caseSensitive = options.caseSensitive === true;
  const matcher = createTextMatcher(options.query, {
    regex,
    caseSensitive
  });
  const files = await listWorkspaceFiles(root, {
    ...(options.glob === undefined ? {} : { glob: options.glob }),
    maxResults: SEARCH_TEXT_FILE_SCAN_LIMIT
  });
  const matches: SearchWorkspaceTextMatch[] = [];
  let filesSearched = 0;
  let truncated = false;

  for (const entry of files.entries) {
    if (truncated) {
      break;
    }

    if (entry.type !== "file") {
      continue;
    }

    const content = await readFile(resolve(root, entry.path), "utf8");

    if (content.includes("\0")) {
      continue;
    }

    filesSearched += 1;
    const lines = content.split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
      if (!matcher(line)) {
        continue;
      }

      matches.push({
        path: entry.path,
        line: index + 1,
        preview: truncatePreview(line),
        ...contextForMatch(lines, index, contextLines)
      });

      if (matches.length >= maxMatches) {
        truncated = true;
        break;
      }
    }
  }

  return {
    cwd: root,
    query: options.query,
    regex,
    caseSensitive,
    matches,
    truncated,
    maxMatches,
    filesSearched,
    filesTruncated: files.truncated
  };
}

function boundedMaxResults(
  value: number | undefined,
  fallback: number,
  limit: number
): number {
  if (value === undefined) {
    return fallback;
  }

  return Math.min(value, limit);
}

function normalizePatterns(patterns: string[] | undefined): string[] {
  return (patterns ?? [])
    .map((pattern) => normalizePath(pattern))
    .filter((pattern) => pattern.length > 0);
}

function matchesListInclude(path: string, patterns: string[]): boolean {
  return patterns.length === 0 || matchesAnyPattern(path, patterns);
}

function matchesAnyPattern(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesGlob(path, pattern));
}

function matchesGlob(path: string, pattern: string): boolean {
  return matchesSegments(pathSegmentsFrom(pattern), pathSegmentsFrom(path));
}

function pathSegmentsFrom(path: string): string[] {
  const normalized = normalizePath(path);

  return normalized === "" ? [] : normalized.split("/");
}

function matchesSegments(pattern: string[], path: string[]): boolean {
  if (pattern.length === 0) {
    return path.length === 0;
  }

  const currentPattern = pattern[0];
  const remainingPattern = pattern.slice(1);

  if (currentPattern === undefined) {
    return path.length === 0;
  }

  if (currentPattern === "**") {
    if (remainingPattern.length === 0) {
      return true;
    }

    for (let index = 0; index <= path.length; index += 1) {
      if (matchesSegments(remainingPattern, path.slice(index))) {
        return true;
      }
    }

    return false;
  }

  const currentPath = path[0];

  return (
    currentPath !== undefined &&
    matchesSegment(currentPattern, currentPath) &&
    matchesSegments(remainingPattern, path.slice(1))
  );
}

function matchesSegment(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const source = escaped.replaceAll("*", "[^/]*").replaceAll("?", "[^/]");

  return new RegExp(`^${source}$`).test(value);
}

function workspaceRelativePath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join("/");
}

function workspaceTarget(
  root: string,
  requestedPath: string,
  options: { allowRoot?: boolean } = {}
): { absolutePath: string; relativePath: string } {
  const absolutePath = resolve(root, requestedPath);
  const relativePath = workspaceRelativePath(root, absolutePath);

  if (
    (relativePath.length === 0 && options.allowRoot !== true) ||
    relativePath === ".." ||
    relativePath.startsWith("../")
  ) {
    throw new Error(`Workspace path escapes root: ${requestedPath}`);
  }

  return {
    absolutePath,
    relativePath: relativePath.length === 0 ? "." : relativePath
  };
}

function normalizePath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function direntType(dirent: Dirent): ListWorkspaceFileEntry["type"] {
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

function statsToEntryType(
  stats: Awaited<ReturnType<typeof lstat>>
): ListWorkspaceFileEntry["type"] {
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

async function summarizeDirectory(
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

async function sortedDirents(directory: string): Promise<Dirent[]> {
  const dirents = await readdir(directory, { withFileTypes: true });

  return dirents.toSorted((left, right) => left.name.localeCompare(right.name));
}

async function isBinaryFile(path: string): Promise<boolean> {
  const sample = (await readFile(path)).subarray(0, BINARY_SAMPLE_BYTES);

  return sample.includes(0);
}

function createTextMatcher(
  query: string,
  options: { regex: boolean; caseSensitive: boolean }
): (line: string) => boolean {
  if (options.regex) {
    const expression = new RegExp(query, options.caseSensitive ? "" : "i");

    return (line) => expression.test(line);
  }

  const needle = options.caseSensitive ? query : query.toLowerCase();

  return (line) => (options.caseSensitive ? line : line.toLowerCase()).includes(needle);
}

function contextForMatch(
  lines: string[],
  index: number,
  contextLines: number
): Pick<SearchWorkspaceTextMatch, "before" | "after"> {
  if (contextLines <= 0) {
    return {};
  }

  const before = lines
    .slice(Math.max(0, index - contextLines), index)
    .map((line, offset, selected) => ({
      line: index - selected.length + offset + 1,
      text: truncatePreview(line)
    }));
  const after = lines
    .slice(index + 1, index + 1 + contextLines)
    .map((line, offset) => ({
      line: index + offset + 2,
      text: truncatePreview(line)
    }));

  return {
    ...(before.length === 0 ? {} : { before }),
    ...(after.length === 0 ? {} : { after })
  };
}

function truncatePreview(value: string): string {
  return value.length <= SEARCH_TEXT_PREVIEW_LIMIT
    ? value
    : `${value.slice(0, SEARCH_TEXT_PREVIEW_LIMIT)}...`;
}
