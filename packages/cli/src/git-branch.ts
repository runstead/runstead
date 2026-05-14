import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type GitRunner = (
  args: string[],
  options: { cwd: string; timeoutMs?: number }
) => Promise<GitCommandResult>;

export interface RunsteadBranchNameOptions {
  taskId: string;
  slug?: string;
  prefix?: string;
}

export interface CreateGitBranchOptions {
  cwd?: string;
  branchName: string;
  baseRef?: string;
  timeoutMs?: number;
  runner?: GitRunner;
}

export interface CreateGitBranchResult {
  cwd: string;
  branchName: string;
  baseRef?: string;
}

export interface PushGitBranchOptions {
  cwd?: string;
  branchName: string;
  remote?: string;
  timeoutMs?: number;
  runner?: GitRunner;
}

export interface PushGitBranchResult {
  cwd: string;
  branchName: string;
  remote: string;
  stdout: string;
}

export interface ListGitChangedFilesOptions {
  cwd?: string;
  timeoutMs?: number;
  runner?: GitRunner;
}

export interface ListGitChangedFilesResult {
  cwd: string;
  changedFiles: string[];
  trackedFiles: string[];
  stagedFiles: string[];
  untrackedFiles: string[];
  excludedFiles: string[];
}

export interface CommitGitChangesOptions {
  cwd?: string;
  message: string;
  changedFiles: string[];
  timeoutMs?: number;
  runner?: GitRunner;
}

export interface CommitGitChangesResult {
  cwd: string;
  message: string;
  commitSha: string;
  changedFiles: string[];
  committedFiles: string[];
  stdout: string;
}

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

function normalizeBranchName(branchName: string): string {
  return branchName
    .split("/")
    .map((segment) => normalizeBranchSegment(segment))
    .filter((segment) => segment.length > 0)
    .join("/");
}

function normalizeBranchSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\.+$/g, "");

  return normalized.length === 0 ? "unnamed" : normalized;
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

function commandExitCode(error: unknown): number {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "number"
  ) {
    return error.code;
  }

  return 1;
}

function assertGitCommand(result: GitCommandResult, description: string): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `${description} failed with exit ${result.exitCode}: ${redactGitOutput(result.stderr)}`
    );
  }
}

export function redactGitOutput(value: string): string {
  return value
    .replace(/(https?:\/\/)([^@\s/]+)@/g, "$1[REDACTED_GIT_CREDENTIAL]@")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[REDACTED_GITHUB_TOKEN]");
}

function commandOutput(error: unknown, key: "stdout" | "stderr"): string {
  if (typeof error === "object" && error !== null) {
    const output = (error as Record<string, unknown>)[key];

    if (typeof output === "string") {
      return output;
    }
  }

  return "";
}

function parsePathLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

function isCommitExcludedPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "");

  return (
    normalized === ".runstead" ||
    normalized.startsWith(".runstead/") ||
    normalized === ".team" ||
    normalized.startsWith(".team/") ||
    normalized === ".git" ||
    normalized.startsWith(".git/") ||
    normalized === "node_modules" ||
    normalized.startsWith("node_modules/")
  );
}
