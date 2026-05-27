import type { WorkerRun } from "@runstead/core";

import { listWorkspaceFiles, workspaceTree } from "../codex-direct-native-tools.js";
import { runGovernedToolAction } from "../governed-action.js";
import { filesystemReadAction, governedToolOptions } from "./policy-actions.js";
import type { CodexDirectWorkerOptions } from "./worker.js";

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
