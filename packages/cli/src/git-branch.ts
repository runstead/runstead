import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import type {
  CommitGitChangesOptions,
  CommitGitChangesResult,
  CreateGitBranchOptions,
  CreateGitBranchResult,
  GitCommandResult,
  ListGitChangedFilesOptions,
  ListGitChangedFilesResult,
  PushGitBranchOptions,
  PushGitBranchResult,
  RunsteadBranchNameOptions
} from "./git-branch-types.js";
import {
  assertGitCommand,
  commandExitCode,
  commandOutput,
  isCommitExcludedPath,
  normalizeBranchName,
  normalizeBranchSegment,
  parsePathLines,
  redactGitOutput,
  uniquePaths
} from "./git-branch-utils.js";

const execFileAsync = promisify(execFile);

export type {
  CommitGitChangesOptions,
  CommitGitChangesResult,
  CreateGitBranchOptions,
  CreateGitBranchResult,
  GitCommandResult,
  GitRunner,
  ListGitChangedFilesOptions,
  ListGitChangedFilesResult,
  PushGitBranchOptions,
  PushGitBranchResult,
  RunsteadBranchNameOptions
} from "./git-branch-types.js";
export { redactGitOutput } from "./git-branch-utils.js";

export const DEFAULT_GIT_CLI_TIMEOUT_MS = 60_000;

export function buildRunsteadBranchName(options: RunsteadBranchNameOptions): string {
  const prefix = normalizeBranchSegment(options.prefix ?? "runstead");
  const task = normalizeBranchSegment(options.taskId);
  const slug =
    options.slug === undefined ? undefined : normalizeBranchSegment(options.slug);

  return [prefix, task, slug]
    .filter((part): part is string => part !== undefined)
    .join("/");
}

export async function createGitBranch(
  options: CreateGitBranchOptions
): Promise<CreateGitBranchResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const branchName = normalizeBranchName(options.branchName);
  const args =
    options.baseRef === undefined
      ? ["switch", "-c", branchName]
      : ["switch", "-c", branchName, options.baseRef];
  const result = await (options.runner ?? runGit)(args, {
    cwd,
    timeoutMs: options.timeoutMs ?? DEFAULT_GIT_CLI_TIMEOUT_MS
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `git switch -c failed with exit ${result.exitCode}: ${redactGitOutput(result.stderr)}`
    );
  }

  return {
    cwd,
    branchName,
    ...(options.baseRef === undefined ? {} : { baseRef: options.baseRef })
  };
}

export async function pushGitBranch(
  options: PushGitBranchOptions
): Promise<PushGitBranchResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const branchName = normalizeBranchName(options.branchName);
  const remote = options.remote ?? "origin";
  const result = await (options.runner ?? runGit)(
    ["push", "--set-upstream", remote, branchName],
    {
      cwd,
      timeoutMs: options.timeoutMs ?? DEFAULT_GIT_CLI_TIMEOUT_MS
    }
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `git push failed with exit ${result.exitCode}: ${redactGitOutput(result.stderr)}`
    );
  }

  return {
    cwd,
    branchName,
    remote,
    stdout: redactGitOutput(result.stdout)
  };
}

export async function listGitChangedFiles(
  options: ListGitChangedFilesOptions = {}
): Promise<ListGitChangedFilesResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const runner = options.runner ?? runGit;
  const commandOptions = {
    cwd,
    timeoutMs: options.timeoutMs ?? DEFAULT_GIT_CLI_TIMEOUT_MS
  };
  const [tracked, staged, untracked] = await Promise.all([
    runner(["diff", "--name-only"], commandOptions),
    runner(["diff", "--cached", "--name-only"], commandOptions),
    runner(["ls-files", "--others", "--exclude-standard"], commandOptions)
  ]);

  assertGitCommand(tracked, "git diff --name-only");
  assertGitCommand(staged, "git diff --cached --name-only");
  assertGitCommand(untracked, "git ls-files --others --exclude-standard");

  const trackedFiles = parsePathLines(tracked.stdout);
  const stagedFiles = parsePathLines(staged.stdout);
  const untrackedFiles = parsePathLines(untracked.stdout);
  const changedFiles = uniquePaths([
    ...trackedFiles,
    ...stagedFiles,
    ...untrackedFiles
  ]);
  const excludedFiles = changedFiles.filter(isCommitExcludedPath);

  return {
    cwd,
    changedFiles,
    trackedFiles,
    stagedFiles,
    untrackedFiles,
    excludedFiles
  };
}

export async function commitGitChanges(
  options: CommitGitChangesOptions
): Promise<CommitGitChangesResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const runner = options.runner ?? runGit;
  const commandOptions = {
    cwd,
    timeoutMs: options.timeoutMs ?? DEFAULT_GIT_CLI_TIMEOUT_MS
  };
  const changedFiles = uniquePaths(options.changedFiles);
  const filesToCommit = changedFiles.filter((path) => !isCommitExcludedPath(path));

  if (filesToCommit.length === 0) {
    throw new Error("No committable git changes found");
  }

  const add = await runner(["add", "--", ...filesToCommit], commandOptions);
  assertGitCommand(add, "git add");

  const staged = await runner(["diff", "--cached", "--name-only"], commandOptions);
  assertGitCommand(staged, "git diff --cached --name-only");

  const committedFiles = parsePathLines(staged.stdout).filter((path) =>
    filesToCommit.includes(path)
  );

  if (committedFiles.length === 0) {
    throw new Error("No staged git changes found after add");
  }

  const commit = await runner(
    ["commit", "--no-gpg-sign", "-m", options.message, "--", ...committedFiles],
    commandOptions
  );
  assertGitCommand(commit, "git commit");

  const revParse = await runner(["rev-parse", "HEAD"], commandOptions);
  assertGitCommand(revParse, "git rev-parse HEAD");

  return {
    cwd,
    message: options.message,
    commitSha: revParse.stdout.trim(),
    changedFiles,
    committedFiles,
    stdout: redactGitOutput(commit.stdout)
  };
}

async function runGit(
  args: string[],
  options: { cwd: string; timeoutMs?: number }
): Promise<GitCommandResult> {
  try {
    const result = await execFileAsync("git", args, {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? DEFAULT_GIT_CLI_TIMEOUT_MS,
      windowsHide: true
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0
    };
  } catch (error) {
    return {
      stdout: commandOutput(error, "stdout"),
      stderr: commandOutput(error, "stderr"),
      exitCode: commandExitCode(error)
    };
  }
}
