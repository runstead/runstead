import type { WorkerRun } from "@runstead/core";

import { gitLogCommand, gitShowCommand, parseGitLogOutput } from "./git-actions.js";
import { runGovernedGitCommand } from "./git-command-runner.js";
import type { CodexDirectWorkerOptions } from "./worker.js";

export { runGovernedGitRead } from "./git-basic-read-tools.js";
export { runGovernedDiffSummary } from "./git-diff-summary-tool.js";

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
