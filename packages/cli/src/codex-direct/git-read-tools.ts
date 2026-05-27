import type { WorkerRun } from "@runstead/core";

import { runGovernedToolAction } from "../governed-action.js";
import { runShellCommand } from "../shell-executor.js";
import {
  diffSummaryTotals,
  firstNonZeroExitCode,
  gitDiffSummaryCommand,
  gitLogCommand,
  gitShowCommand,
  mergeDiffSummaryRows,
  parseGitLogOutput
} from "./git-actions.js";
import { runGovernedGitCommand } from "./git-command-runner.js";
import { governedToolOptions } from "./policy-actions.js";
import { gitReadAction } from "./policy-actions.js";
import type { CodexDirectWorkerOptions } from "./worker.js";

export { runGovernedGitRead } from "./git-basic-read-tools.js";

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

export async function runGovernedGitLog(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    range?: string;
    path?: string;
    maxCommits?: number;
  }
) {
  const maxCommits = Math.min(options.maxCommits ?? 20, 100);
  const command = gitLogCommand({
    range: options.range,
    path: options.path,
    maxCommits
  });

  return runGovernedGitCommand({
    ...options,
    actionType: "git.log",
    command,
    output: (result) => ({
      command,
      exitCode: result.exitCode,
      stderr: result.stderr,
      commits: parseGitLogOutput(result.stdout),
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated
    })
  });
}

export async function runGovernedGitShow(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    ref: string;
    path?: string;
    maxBytes?: number;
  }
) {
  const command = gitShowCommand({
    ref: options.ref,
    path: options.path
  });

  return runGovernedGitCommand({
    ...options,
    actionType: "git.show",
    command,
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    output: (result) => ({
      command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated
    })
  });
}
