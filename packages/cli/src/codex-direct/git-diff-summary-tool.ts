import type { WorkerRun } from "@runstead/core";

import { runGovernedToolAction } from "../governed-action.js";
import { runShellCommand } from "../shell-executor.js";
import {
  diffSummaryTotals,
  firstNonZeroExitCode,
  gitDiffSummaryCommand,
  mergeDiffSummaryRows
} from "./git-actions.js";
import { gitReadAction, governedToolOptions } from "./policy-actions.js";
import type { CodexDirectWorkerOptions } from "./worker.js";

export async function runGovernedDiffSummary(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    path?: string;
    staged: boolean;
    base?: string;
    maxFiles?: number;
  }
) {
  const maxFiles = Math.min(options.maxFiles ?? 100, 1_000);
  const input = {
    path: options.path,
    staged: options.staged,
    base: options.base
  };
  const numstatCommand = gitDiffSummaryCommand("--numstat", input);
  const nameStatusCommand = gitDiffSummaryCommand("--name-status", input);
  const shortstatCommand = gitDiffSummaryCommand("--shortstat", input);

  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: gitReadAction({
      cwd: options.cwd,
      actionType: "git.diff.summary"
    }),
    run: async () => {
      const [numstat, nameStatus, shortstat] = await Promise.all([
        runShellCommand({
          command: numstatCommand,
          cwd: options.cwd
        }),
        runShellCommand({
          command: nameStatusCommand,
          cwd: options.cwd
        }),
        runShellCommand({
          command: shortstatCommand,
          cwd: options.cwd
        })
      ]);
      const files = mergeDiffSummaryRows({
        numstat: numstat.stdout,
        nameStatus: nameStatus.stdout
      });
      const truncated = files.length > maxFiles;
      const value = {
        commands: {
          numstat: numstatCommand,
          nameStatus: nameStatusCommand,
          shortstat: shortstatCommand
        },
        exitCode: firstNonZeroExitCode([numstat, nameStatus, shortstat]),
        files: files.slice(0, maxFiles),
        totals: diffSummaryTotals(files),
        shortstat: shortstat.stdout.trim(),
        truncated,
        maxFiles
      };

      return {
        value,
        output: {
          files: value.files.length,
          truncated,
          additions: value.totals.additions,
          deletions: value.totals.deletions,
          shortstat: value.shortstat
        }
      };
    }
  }).then((result) => result.value);
}
