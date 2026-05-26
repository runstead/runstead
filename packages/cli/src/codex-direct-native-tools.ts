import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  inspectPackageScriptsTarget,
  type PackageScriptsInspectionResult
} from "./codex-direct-package-scripts.js";
import {
  assertNoWorkspaceSymlinkTraversal,
  boundedMaxResults,
  readableWorkspacePath,
  safeWorkspaceTarget,
  workspaceTarget
} from "./codex-direct-workspace-paths.js";
import {
  isBinaryFile,
  statsToEntryType,
  summarizeDirectory,
  type ListWorkspaceFileEntry,
  type WorkspaceDirectorySummary
} from "./codex-direct-workspace-entries.js";

export type {
  CodexDirectPackageManager,
  PackageScriptSummary,
  PackageScriptsInspectionResult,
  PackageVerifierCandidate
} from "./codex-direct-package-scripts.js";

const DEFAULT_READ_MANY_BYTES_PER_FILE = 64 * 1024;
const READ_MANY_BYTES_PER_FILE_LIMIT = 1024 * 1024;
const DEFAULT_READ_MANY_TOTAL_BYTES = 256 * 1024;
const READ_MANY_TOTAL_BYTES_LIMIT = 2 * 1024 * 1024;
export { searchWorkspaceText } from "./codex-direct-workspace-search.js";
export type {
  SearchWorkspaceTextContextLine,
  SearchWorkspaceTextMatch,
  SearchWorkspaceTextOptions,
  SearchWorkspaceTextResult
} from "./codex-direct-workspace-search.js";
export type {
  ListWorkspaceFileEntry,
  WorkspaceDirectorySummary
} from "./codex-direct-workspace-entries.js";
export { listWorkspaceFiles, workspaceTree } from "./codex-direct-workspace-listing.js";
export type {
  ListWorkspaceFilesOptions,
  ListWorkspaceFilesResult,
  WorkspaceTreeEntry,
  WorkspaceTreeOptions,
  WorkspaceTreeResult
} from "./codex-direct-workspace-listing.js";
export {
  applyWorkspacePatch,
  inferWorkspacePatchTouchedFiles
} from "./codex-direct-workspace-patch.js";
export type {
  ApplyWorkspacePatchOptions,
  ApplyWorkspacePatchReplacement,
  ApplyWorkspacePatchResult
} from "./codex-direct-workspace-patch.js";

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

export interface InspectPackageScriptsOptions {
  path?: string;
}

export async function inspectPackageScripts(
  cwd: string,
  options: InspectPackageScriptsOptions = {}
): Promise<PackageScriptsInspectionResult> {
  const root = resolve(cwd);
  const target = await safeWorkspaceTarget(root, options.path ?? ".", {
    allowRoot: true
  });

  return inspectPackageScriptsTarget({
    root,
    absolutePath: target.absolutePath,
    relativePath: target.relativePath
  });
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
