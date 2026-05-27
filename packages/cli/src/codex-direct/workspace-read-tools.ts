import type { WorkerRun } from "@runstead/core";

import {
  inspectWorkspacePath,
  listWorkspaceFiles,
  readManyWorkspaceFiles,
  workspaceTree
} from "../codex-direct-native-tools.js";
import { runGovernedToolAction } from "../governed-action.js";
import { type CodexDirectWorkerOptions } from "./worker.js";
import { governedToolOptions } from "./policy-actions.js";
import { filesystemReadAction } from "./policy-actions.js";

export async function runGovernedFileInfo(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    path: string;
    maxEntries?: number;
  }
) {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: filesystemReadAction({
      cwd: options.cwd,
      actionType: "filesystem.stat",
      path: options.path,
      stableParts: [options.cwd, options.path, options.maxEntries]
    }),
    run: async () => {
      const value = await inspectWorkspacePath(options.cwd, {
        path: options.path,
        ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries })
      });

      return {
        value,
        output: {
          path: value.path,
          type: value.type,
          bytes: value.bytes,
          ...(value.directory === undefined
            ? {}
            : {
                entries: value.directory.entries.length,
                truncated: value.directory.truncated
              })
        }
      };
    }
  }).then((result) => result.value);
}

export async function runGovernedTree(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    path: string;
    maxDepth?: number;
    maxEntries?: number;
    includeFiles: boolean;
  }
) {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: filesystemReadAction({
      cwd: options.cwd,
      actionType: "filesystem.list",
      path: options.path,
      stableParts: [
        options.cwd,
        options.path,
        options.maxDepth,
        options.maxEntries,
        options.includeFiles
      ]
    }),
    run: async () => {
      const value = await workspaceTree(options.cwd, {
        path: options.path,
        ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
        ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
        includeFiles: options.includeFiles
      });

      return {
        value,
        output: {
          path: value.path,
          entries: value.entries.length,
          truncated: value.truncated,
          maxDepth: value.maxDepth
        }
      };
    }
  }).then((result) => result.value);
}

export async function runGovernedReadManyFiles(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    paths: string[];
    maxBytesPerFile?: number;
    maxTotalBytes?: number;
  }
) {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: filesystemReadAction({
      cwd: options.cwd,
      actionType: "filesystem.read",
      path: ".",
      filesTouched: options.paths,
      stableParts: [
        options.cwd,
        options.paths,
        options.maxBytesPerFile,
        options.maxTotalBytes
      ]
    }),
    run: async () => {
      const value = await readManyWorkspaceFiles(options.cwd, {
        paths: options.paths,
        ...(options.maxBytesPerFile === undefined
          ? {}
          : { maxBytesPerFile: options.maxBytesPerFile }),
        ...(options.maxTotalBytes === undefined
          ? {}
          : { maxTotalBytes: options.maxTotalBytes })
      });

      return {
        value,
        output: {
          files: value.files.length,
          errors: value.errors.length,
          bytes: value.bytes,
          returnedBytes: value.returnedBytes,
          truncated: value.truncated
        }
      };
    }
  }).then((result) => result.value);
}

export async function runGovernedListFiles(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    glob?: string[];
    exclude?: string[];
    maxResults?: number;
    includeDirs: boolean;
  }
) {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: filesystemReadAction({
      cwd: options.cwd,
      actionType: "filesystem.list",
      path: ".",
      stableParts: [
        options.cwd,
        options.glob ?? [],
        options.exclude ?? [],
        options.maxResults,
        options.includeDirs
      ]
    }),
    run: async () => {
      const value = await listWorkspaceFiles(options.cwd, {
        ...(options.glob === undefined ? {} : { glob: options.glob }),
        ...(options.exclude === undefined ? {} : { exclude: options.exclude }),
        ...(options.maxResults === undefined ? {} : { maxResults: options.maxResults }),
        includeDirs: options.includeDirs
      });

      return {
        value,
        output: {
          entries: value.entries.length,
          truncated: value.truncated,
          maxResults: value.maxResults
        }
      };
    }
  }).then((result) => result.value);
}
