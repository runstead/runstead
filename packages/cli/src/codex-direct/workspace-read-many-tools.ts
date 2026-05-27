import type { WorkerRun } from "@runstead/core";

import { readManyWorkspaceFiles } from "../codex-direct-native-tools.js";
import { runGovernedToolAction } from "../governed-action.js";
import { filesystemReadAction, governedToolOptions } from "./policy-actions.js";
import type { CodexDirectWorkerOptions } from "./worker.js";

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
