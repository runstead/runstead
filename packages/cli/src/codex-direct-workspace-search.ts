import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  contextForSearchTextMatch,
  createTextMatcher,
  truncateSearchTextPreview
} from "./codex-direct-search-text.js";
import { boundedMaxResults } from "./codex-direct-workspace-paths.js";
import { listWorkspaceFiles } from "./codex-direct-workspace-listing.js";

const DEFAULT_SEARCH_TEXT_MAX_MATCHES = 100;
const SEARCH_TEXT_MAX_MATCHES_LIMIT = 500;
const SEARCH_TEXT_FILE_SCAN_LIMIT = 1_000;
const SEARCH_TEXT_CONTEXT_LIMIT = 5;
const DEFAULT_SEARCH_TEXT_MAX_BYTES_PER_FILE = 512 * 1024;
const SEARCH_TEXT_MAX_BYTES_PER_FILE_LIMIT = 2 * 1024 * 1024;

export interface SearchWorkspaceTextOptions {
  query: string;
  regex?: boolean;
  glob?: string[];
  caseSensitive?: boolean;
  contextLines?: number;
  maxMatches?: number;
  maxBytesPerFile?: number;
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
  maxBytesPerFile: number;
  filesSearched: number;
  filesTruncated: boolean;
  filesSkippedTooLarge: number;
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
  const maxBytesPerFile = boundedMaxResults(
    options.maxBytesPerFile,
    DEFAULT_SEARCH_TEXT_MAX_BYTES_PER_FILE,
    SEARCH_TEXT_MAX_BYTES_PER_FILE_LIMIT
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
  let filesSkippedTooLarge = 0;
  let truncated = false;

  for (const entry of files.entries) {
    if (truncated) {
      break;
    }

    if (entry.type !== "file") {
      continue;
    }

    const absolutePath = resolve(root, entry.path);
    const stats = await lstat(absolutePath);

    if (!stats.isFile()) {
      continue;
    }

    if (stats.size > maxBytesPerFile) {
      filesSkippedTooLarge += 1;
      continue;
    }

    const content = await readFile(absolutePath, "utf8");

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
        preview: truncateSearchTextPreview(line),
        ...contextForSearchTextMatch(lines, index, contextLines)
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
    maxBytesPerFile,
    filesSearched,
    filesTruncated: files.truncated,
    filesSkippedTooLarge
  };
}
