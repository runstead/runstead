import type { WorkerRun } from "@runstead/core";

import { searchWorkspaceText } from "../codex-direct-native-tools.js";
import { runGovernedToolAction } from "../governed-action.js";
import { filesystemReadAction, governedToolOptions } from "./policy-actions.js";
import { type CodexDirectWorkerOptions } from "./worker.js";

export async function runGovernedSearchText(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    query: string;
    regex: boolean;
    glob?: string[];
    caseSensitive: boolean;
    contextLines?: number;
    maxMatches?: number;
    maxBytesPerFile?: number;
  }
) {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: filesystemReadAction({
      cwd: options.cwd,
      actionType: "filesystem.search",
      path: ".",
      stableParts: [
        options.cwd,
        options.query,
        options.regex,
        options.glob ?? [],
        options.caseSensitive,
        options.contextLines,
        options.maxMatches,
        options.maxBytesPerFile
      ]
    }),
    run: async () => {
      const value = await searchWorkspaceText(options.cwd, {
        query: options.query,
        regex: options.regex,
        ...(options.glob === undefined ? {} : { glob: options.glob }),
        caseSensitive: options.caseSensitive,
        ...(options.contextLines === undefined
          ? {}
          : { contextLines: options.contextLines }),
        ...(options.maxMatches === undefined ? {} : { maxMatches: options.maxMatches }),
        ...(options.maxBytesPerFile === undefined
          ? {}
          : { maxBytesPerFile: options.maxBytesPerFile })
      });

      return {
        value,
        output: {
          matches: value.matches.length,
          truncated: value.truncated,
          filesSearched: value.filesSearched,
          filesTruncated: value.filesTruncated,
          filesSkippedTooLarge: value.filesSkippedTooLarge
        }
      };
    }
  }).then((result) => result.value);
}
