import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  inspectPackageScriptsTarget,
  type PackageScriptsInspectionResult
} from "./codex-direct-package-scripts.js";
import {
  assertNoWorkspaceSymlinkTraversal,
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

export { readManyWorkspaceFiles } from "./codex-direct-workspace-read-many.js";
export type {
  ReadManyWorkspaceFile,
  ReadManyWorkspaceFileError,
  ReadManyWorkspaceFilesOptions,
  ReadManyWorkspaceFilesResult
} from "./codex-direct-workspace-read-many.js";
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
