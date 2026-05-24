import type { Dirent } from "node:fs";
import {
  access,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

import { parse as parseYaml } from "yaml";

import { runShellCommand } from "./shell-executor.js";

const DEFAULT_IGNORED_DIRECTORIES = [".git", "node_modules", "dist", ".runstead"];
const DEFAULT_LIST_FILES_MAX_RESULTS = 200;
const LIST_FILES_MAX_RESULTS_LIMIT = 1_000;
const DEFAULT_SEARCH_TEXT_MAX_MATCHES = 100;
const SEARCH_TEXT_MAX_MATCHES_LIMIT = 500;
const SEARCH_TEXT_FILE_SCAN_LIMIT = 1_000;
const SEARCH_TEXT_CONTEXT_LIMIT = 5;
const SEARCH_TEXT_PREVIEW_LIMIT = 500;
const DEFAULT_SEARCH_TEXT_MAX_BYTES_PER_FILE = 512 * 1024;
const SEARCH_TEXT_MAX_BYTES_PER_FILE_LIMIT = 2 * 1024 * 1024;
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
const STANDARD_VERIFIER_SCRIPT_NAMES = ["test", "lint", "typecheck"] as const;

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

export interface ReadManyWorkspaceFileError {
  path: string;
  error: string;
}

export interface ReadManyWorkspaceFilesResult {
  cwd: string;
  files: ReadManyWorkspaceFile[];
  errors: ReadManyWorkspaceFileError[];
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

export type CodexDirectPackageManager = "pnpm" | "npm" | "yarn" | "bun";

export interface InspectPackageScriptsOptions {
  path?: string;
}

export interface PackageScriptSummary {
  name: string;
  command: string;
}

export interface PackageVerifierCandidate {
  name: string;
  command: string;
  source: "package_script" | "turbo_task";
}

export interface PackageScriptsInspectionResult {
  cwd: string;
  path: string;
  packageJsonPath?: string;
  packageManager: CodexDirectPackageManager;
  packageManagerSource: "package_json" | "lockfile" | "default";
  scripts: PackageScriptSummary[];
  verifierCandidates: PackageVerifierCandidate[];
  workspace: {
    pnpmWorkspace: boolean;
    packagePatterns: string[];
    turboTasks: string[];
  };
}

export interface ApplyWorkspacePatchReplacement {
  path: string;
  search: string;
  replace: string;
  replaceAll?: boolean;
}

export interface ApplyWorkspacePatchOptions {
  patch?: string;
  replacements?: ApplyWorkspacePatchReplacement[];
}

export interface ApplyWorkspacePatchResult {
  mode: "unified_diff" | "replacements";
  filesTouched: string[];
  applied: boolean;
  summary: string;
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

export async function inspectPackageScripts(
  cwd: string,
  options: InspectPackageScriptsOptions = {}
): Promise<PackageScriptsInspectionResult> {
  const root = resolve(cwd);
  const target = await safeWorkspaceTarget(root, options.path ?? ".", {
    allowRoot: true
  });
  const packageJsonPath = join(target.absolutePath, "package.json");
  const packageJson = await readPackageJson(packageJsonPath);
  const packageManager = await detectPackageManager(target.absolutePath, packageJson);
  const turboTasks = await readTurboTasks(target.absolutePath);
  const scripts = Object.entries(packageJson?.scripts ?? {})
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([name, command]) => ({ name, command }));

  return {
    cwd: root,
    path: target.relativePath,
    ...(packageJson === undefined ? {} : { packageJsonPath }),
    packageManager: packageManager.packageManager,
    packageManagerSource: packageManager.source,
    scripts,
    verifierCandidates: verifierCandidates({
      packageManager: packageManager.packageManager,
      scripts: packageJson?.scripts ?? {},
      turboTasks
    }),
    workspace: {
      pnpmWorkspace: await exists(join(target.absolutePath, "pnpm-workspace.yaml")),
      packagePatterns: await readPnpmWorkspacePatterns(target.absolutePath),
      turboTasks: [...turboTasks].sort()
    }
  };
}

export async function applyWorkspacePatch(
  cwd: string,
  options: ApplyWorkspacePatchOptions
): Promise<ApplyWorkspacePatchResult> {
  const root = resolve(cwd);

  if (options.patch !== undefined && options.replacements !== undefined) {
    throw new Error("apply_patch accepts either patch or replacements, not both");
  }

  if (options.patch !== undefined) {
    return applyUnifiedDiff(root, options.patch);
  }

  if (options.replacements !== undefined) {
    return applyStructuredReplacements(root, options.replacements);
  }

  throw new Error("apply_patch requires patch or replacements");
}

export function inferWorkspacePatchTouchedFiles(
  options: ApplyWorkspacePatchOptions
): string[] {
  if (options.replacements !== undefined) {
    return uniqueStrings(
      options.replacements.map((replacement) => normalizePath(replacement.path))
    );
  }

  if (options.patch !== undefined) {
    return uniqueStrings([
      ...parseUnifiedDiffTouchedFiles(options.patch),
      ...parseCodexApplyPatchTouchedFiles(options.patch)
    ]);
  }

  return [];
}

export async function inspectWorkspacePath(
  cwd: string,
  options: WorkspaceFileInfoOptions
): Promise<WorkspaceFileInfoResult> {
  const root = resolve(cwd);
  const target = workspaceTarget(root, options.path, { allowRoot: true });
  await assertNoWorkspaceSymlinkTraversal(root, target, options.path, {
    allowFinalSymlink: true
  });
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
      options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }
    );
  }

  return result;
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
  const errors: ReadManyWorkspaceFileError[] = [];
  let bytes = 0;
  let returnedBytes = 0;

  for (const requestedPath of options.paths) {
    try {
      const target = await safeWorkspaceTarget(root, requestedPath);
      const buffer = await readFile(target.absolutePath);
      const fileBytes = buffer.byteLength;
      const remainingTotalBytes = Math.max(0, maxTotalBytes - returnedBytes);
      const fileReturnedBytes = Math.min(
        fileBytes,
        maxBytesPerFile,
        remainingTotalBytes
      );
      const content = buffer.subarray(0, fileReturnedBytes).toString("utf8");
      const contentBytes = Buffer.byteLength(content, "utf8");
      const truncated = fileReturnedBytes < fileBytes;

      bytes += fileBytes;
      returnedBytes += contentBytes;
      files.push({
        path: target.relativePath,
        content,
        bytes: fileBytes,
        returnedBytes: contentBytes,
        truncated
      });
    } catch (error) {
      errors.push({
        path: readableWorkspacePath(root, requestedPath),
        error: errorMessage(error)
      });
    }
  }

  return {
    cwd: root,
    files,
    errors,
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
    maxBytesPerFile,
    filesSearched,
    filesTruncated: files.truncated,
    filesSkippedTooLarge
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

function readableWorkspacePath(root: string, requestedPath: string): string {
  try {
    return workspaceTarget(root, requestedPath, { allowRoot: true }).relativePath;
  } catch {
    return normalizePath(requestedPath) || ".";
  }
}

async function safeWorkspaceTarget(
  root: string,
  requestedPath: string,
  options: {
    allowRoot?: boolean;
    allowFinalSymlink?: boolean;
    allowMissingDescendants?: boolean;
  } = {}
): Promise<{ absolutePath: string; relativePath: string }> {
  const target = workspaceTarget(root, requestedPath, options);

  await assertNoWorkspaceSymlinkTraversal(root, target, requestedPath, options);

  return target;
}

async function assertNoWorkspaceSymlinkTraversal(
  root: string,
  target: { relativePath: string },
  requestedPath: string,
  options: {
    allowFinalSymlink?: boolean;
    allowMissingDescendants?: boolean;
  } = {}
): Promise<void> {
  if (target.relativePath === ".") {
    return;
  }

  const realRoot = await realpath(root);
  const segments = target.relativePath.split("/");
  let current = realRoot;

  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const isFinal = index === segments.length - 1;

    try {
      const stats = await lstat(current);

      if (stats.isSymbolicLink() && !(isFinal && options.allowFinalSymlink === true)) {
        throw new Error(`Workspace path crosses symlink: ${requestedPath}`);
      }
    } catch (error) {
      if (
        options.allowMissingDescendants === true &&
        isNodeErrorCode(error, "ENOENT")
      ) {
        return;
      }

      throw error;
    }
  }
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

async function applyUnifiedDiff(
  root: string,
  patch: string
): Promise<ApplyWorkspacePatchResult> {
  const filesTouched = parseUnifiedDiffTouchedFiles(patch);

  if (filesTouched.length === 0) {
    throw new Error("Unified diff does not contain any workspace file paths");
  }

  for (const path of filesTouched) {
    await safeWorkspaceTarget(root, path, {
      allowRoot: false,
      allowMissingDescendants: true
    });
  }

  const tempDir = await mkdtemp(join(tmpdir(), "runstead-apply-patch-"));
  const patchPath = join(tempDir, "change.patch");

  try {
    await writeFile(patchPath, patch, "utf8");
    const check = await runShellCommand({
      command: `git apply --check --whitespace=nowarn ${shellQuote(patchPath)}`,
      cwd: root
    });

    if (check.exitCode !== 0) {
      throw new Error(check.stderr || check.stdout || "git apply --check failed");
    }

    const applied = await runShellCommand({
      command: `git apply --whitespace=nowarn ${shellQuote(patchPath)}`,
      cwd: root
    });

    if (applied.exitCode !== 0) {
      throw new Error(applied.stderr || applied.stdout || "git apply failed");
    }

    return {
      mode: "unified_diff",
      filesTouched,
      applied: true,
      summary: `Applied unified diff to ${filesTouched.length} file(s)`
    };
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

async function applyStructuredReplacements(
  root: string,
  replacements: ApplyWorkspacePatchReplacement[]
): Promise<ApplyWorkspacePatchResult> {
  if (replacements.length === 0) {
    throw new Error("apply_patch replacements must not be empty");
  }

  const filesTouched = uniqueStrings(
    replacements.map(
      (replacement) => workspaceTarget(root, replacement.path).relativePath
    )
  );

  for (const replacement of replacements) {
    if (replacement.search.length === 0) {
      throw new Error(`Replacement search text must not be empty: ${replacement.path}`);
    }

    const target = await safeWorkspaceTarget(root, replacement.path);
    const original = await readFile(target.absolutePath, "utf8");
    const occurrences = countOccurrences(original, replacement.search);

    if (occurrences === 0) {
      throw new Error(`Replacement search text not found: ${replacement.path}`);
    }

    if (occurrences > 1 && replacement.replaceAll !== true) {
      throw new Error(
        `Replacement search text is ambiguous in ${replacement.path}; set replaceAll to true`
      );
    }

    const updated =
      replacement.replaceAll === true
        ? original.split(replacement.search).join(replacement.replace)
        : original.replace(replacement.search, replacement.replace);

    await writeFile(target.absolutePath, updated, "utf8");
  }

  return {
    mode: "replacements",
    filesTouched,
    applied: true,
    summary: `Applied ${replacements.length} structured replacement(s) to ${filesTouched.length} file(s)`
  };
}

function parseUnifiedDiffTouchedFiles(patch: string): string[] {
  const paths: string[] = [];

  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("+++ ")) {
      const path = normalizeDiffPath(line.slice(4).trim(), "b/");

      if (path !== undefined) {
        paths.push(path);
      }
    } else if (line.startsWith("--- ")) {
      const path = normalizeDiffPath(line.slice(4).trim(), "a/");

      if (path !== undefined) {
        paths.push(path);
      }
    } else if (line.startsWith("diff --git ")) {
      for (const path of parseGitDiffHeaderPaths(line)) {
        paths.push(path);
      }
    } else if (
      line.startsWith("rename from ") ||
      line.startsWith("rename to ") ||
      line.startsWith("copy from ") ||
      line.startsWith("copy to ")
    ) {
      const path = normalizeDiffPath(diffMetadataPath(line));

      if (path !== undefined) {
        paths.push(path);
      }
    }
  }

  return uniqueStrings(paths);
}

function parseCodexApplyPatchTouchedFiles(patch: string): string[] {
  const paths: string[] = [];

  for (const line of patch.split(/\r?\n/)) {
    const fileMatch = /^\*\*\* (?:Add|Update|Delete) File:\s*(?<path>.+?)\s*$/.exec(
      line
    );

    if (fileMatch?.groups?.path !== undefined) {
      paths.push(normalizePath(fileMatch.groups.path));
      continue;
    }

    const moveMatch = /^\*\*\* Move to:\s*(?<path>.+?)\s*$/.exec(line);

    if (moveMatch?.groups?.path !== undefined) {
      paths.push(normalizePath(moveMatch.groups.path));
    }
  }

  return uniqueStrings(paths);
}

function parseGitDiffHeaderPaths(line: string): string[] {
  const tokens = splitGitDiffHeaderArgs(line.slice("diff --git ".length));
  const [left, right] = tokens;

  return [left, right]
    .map((path) => (path === undefined ? undefined : normalizeDiffPath(path)))
    .filter((path): path is string => path !== undefined);
}

function splitGitDiffHeaderArgs(value: string): string[] {
  const tokens: string[] = [];
  let index = 0;

  while (index < value.length) {
    while (/\s/.test(value[index] ?? "")) {
      index += 1;
    }

    if (index >= value.length) {
      break;
    }

    if (value[index] === "\"") {
      const start = index;
      index += 1;

      while (index < value.length) {
        if (value[index] === "\\" && index + 1 < value.length) {
          index += 2;
          continue;
        }

        if (value[index] === "\"") {
          index += 1;
          break;
        }

        index += 1;
      }

      tokens.push(unquoteGitPath(value.slice(start, index)));
      continue;
    }

    const start = index;

    while (index < value.length && !/\s/.test(value[index] ?? "")) {
      index += 1;
    }

    tokens.push(value.slice(start, index));
  }

  return tokens;
}

function normalizeDiffPath(path: string, prefix?: "a/" | "b/"): string | undefined {
  const unquoted = diffPathToken(path);

  if (unquoted === "/dev/null") {
    return undefined;
  }

  const withoutPrefix =
    prefix !== undefined && unquoted.startsWith(prefix)
    ? unquoted.slice(prefix.length)
    : unquoted.startsWith("a/") || unquoted.startsWith("b/")
      ? unquoted.slice(2)
      : unquoted;

  return normalizePath(withoutPrefix);
}

function diffPathToken(path: string): string {
  const trimmed = path.trim();

  if (trimmed.startsWith('"')) {
    return splitGitDiffHeaderArgs(trimmed)[0] ?? trimmed;
  }

  return trimmed.split("\t", 1)[0] ?? trimmed;
}

function diffMetadataPath(line: string): string {
  for (const prefix of ["rename from ", "rename to ", "copy from ", "copy to "]) {
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length).trim();
    }
  }

  return line.trim();
}

function unquoteGitPath(path: string): string {
  try {
    return JSON.parse(path) as string;
  } catch {
    return path;
  }
}

function countOccurrences(value: string, search: string): number {
  return value.split(search).length - 1;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function readPackageJson(path: string): Promise<
  | {
      packageManager?: string;
      scripts: Record<string, string>;
    }
  | undefined
> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;

    if (!isRecord(parsed)) {
      return undefined;
    }

    return {
      ...(typeof parsed.packageManager === "string"
        ? { packageManager: parsed.packageManager }
        : {}),
      scripts: readScripts(parsed.scripts)
    };
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

function readScripts(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([name, command]) =>
      typeof command === "string" ? [[name, command]] : []
    )
  );
}

async function detectPackageManager(
  cwd: string,
  packageJson: { packageManager?: string } | undefined
): Promise<{
  packageManager: CodexDirectPackageManager;
  source: PackageScriptsInspectionResult["packageManagerSource"];
}> {
  const declared = parsePackageManagerName(packageJson?.packageManager);

  if (declared !== undefined) {
    return {
      packageManager: declared,
      source: "package_json"
    };
  }

  const lockfile = await detectPackageManagerFromLockfile(cwd);

  if (lockfile !== undefined) {
    return {
      packageManager: lockfile,
      source: "lockfile"
    };
  }

  return {
    packageManager: "npm",
    source: "default"
  };
}

async function detectPackageManagerFromLockfile(
  cwd: string
): Promise<CodexDirectPackageManager | undefined> {
  if (await exists(join(cwd, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if ((await exists(join(cwd, "yarn.lock"))) === true) {
    return "yarn";
  }

  if ((await exists(join(cwd, "bun.lock"))) || (await exists(join(cwd, "bun.lockb")))) {
    return "bun";
  }

  if (
    (await exists(join(cwd, "package-lock.json"))) ||
    (await exists(join(cwd, "npm-shrinkwrap.json")))
  ) {
    return "npm";
  }

  return undefined;
}

function parsePackageManagerName(
  value: string | undefined
): CodexDirectPackageManager | undefined {
  const name = value?.split("@")[0];

  return isPackageManager(name) ? name : undefined;
}

function isPackageManager(
  value: string | undefined
): value is CodexDirectPackageManager {
  return value === "pnpm" || value === "npm" || value === "yarn" || value === "bun";
}

async function readPnpmWorkspacePatterns(cwd: string): Promise<string[]> {
  try {
    const parsed = parseYaml(
      await readFile(join(cwd, "pnpm-workspace.yaml"), "utf8")
    ) as unknown;

    if (!isRecord(parsed) || !Array.isArray(parsed.packages)) {
      return [];
    }

    return parsed.packages.filter(
      (pattern): pattern is string => typeof pattern === "string"
    );
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }
}

async function readTurboTasks(cwd: string): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(
      await readFile(join(cwd, "turbo.json"), "utf8")
    ) as unknown;

    if (!isRecord(parsed)) {
      return new Set();
    }

    const tasks = isRecord(parsed.tasks)
      ? Object.keys(parsed.tasks)
      : isRecord(parsed.pipeline)
        ? Object.keys(parsed.pipeline)
        : [];

    return new Set(tasks);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return new Set();
    }

    throw error;
  }
}

function verifierCandidates(input: {
  packageManager: CodexDirectPackageManager;
  scripts: Record<string, string>;
  turboTasks: Set<string>;
}): PackageVerifierCandidate[] {
  return STANDARD_VERIFIER_SCRIPT_NAMES.flatMap((name): PackageVerifierCandidate[] => {
    if (input.scripts[name] !== undefined) {
      return [
        {
          name,
          command: packageManagerScriptCommand(input.packageManager, name),
          source: "package_script"
        }
      ];
    }

    if (input.turboTasks.has(name)) {
      return [
        {
          name,
          command: turboScriptCommand(input.packageManager, name),
          source: "turbo_task"
        }
      ];
    }

    return [];
  });
}

function packageManagerScriptCommand(
  packageManager: CodexDirectPackageManager,
  script: (typeof STANDARD_VERIFIER_SCRIPT_NAMES)[number]
): string {
  switch (packageManager) {
    case "pnpm":
      return `pnpm ${script}`;
    case "npm":
      return script === "test" ? "npm test" : `npm run ${script}`;
    case "yarn":
      return `yarn ${script}`;
    case "bun":
      return `bun run ${script}`;
  }
}

function turboScriptCommand(
  packageManager: CodexDirectPackageManager,
  script: (typeof STANDARD_VERIFIER_SCRIPT_NAMES)[number]
): string {
  switch (packageManager) {
    case "pnpm":
      return `pnpm exec turbo run ${script}`;
    case "npm":
      return `npm exec -- turbo run ${script}`;
    case "yarn":
      return `yarn turbo run ${script}`;
    case "bun":
      return `bunx turbo run ${script}`;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
