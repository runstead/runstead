import type { WorkerRun } from "@runstead/core";

import {
  inspectWorkspacePath,
  readManyWorkspaceFiles
} from "../codex-direct-native-tools.js";
import { runGovernedToolAction } from "../governed-action.js";
import { type CodexDirectWorkerOptions } from "./worker.js";
import { governedToolOptions } from "./policy-actions.js";
import { filesystemReadAction } from "./policy-actions.js";

export { runGovernedListFiles, runGovernedTree } from "./workspace-list-tools.js";

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
