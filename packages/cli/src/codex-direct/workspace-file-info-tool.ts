import type { WorkerRun } from "@runstead/core";

import { inspectWorkspacePath } from "../codex-direct-native-tools.js";
import { runGovernedToolAction } from "../governed-action.js";
import { filesystemReadAction, governedToolOptions } from "./policy-actions.js";
import type { CodexDirectWorkerOptions } from "./worker.js";

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
