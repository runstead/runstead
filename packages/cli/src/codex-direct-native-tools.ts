import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const DEFAULT_IGNORED_DIRECTORIES = [".git", "node_modules", "dist", ".runstead"];
const DEFAULT_LIST_FILES_MAX_RESULTS = 200;
const LIST_FILES_MAX_RESULTS_LIMIT = 1_000;
const DEFAULT_SEARCH_TEXT_MAX_MATCHES = 100;
const SEARCH_TEXT_MAX_MATCHES_LIMIT = 500;
const SEARCH_TEXT_FILE_SCAN_LIMIT = 1_000;
const SEARCH_TEXT_CONTEXT_LIMIT = 5;
const SEARCH_TEXT_PREVIEW_LIMIT = 500;

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

    const dirents = await readdir(directory, { withFileTypes: true });
    const sorted = dirents.toSorted((left, right) =>
      left.name.localeCompare(right.name)
    );

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
