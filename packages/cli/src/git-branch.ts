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
  options: { cwd: string }
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
  runner?: GitRunner;
}

export interface CreateGitBranchResult {
  cwd: string;
  branchName: string;
  baseRef?: string;
}

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
  const result = await (options.runner ?? runGit)(args, { cwd });

  if (result.exitCode !== 0) {
    throw new Error(
      `git switch -c failed with exit ${result.exitCode}: ${result.stderr}`
    );
  }

  return {
    cwd,
    branchName,
    ...(options.baseRef === undefined ? {} : { baseRef: options.baseRef })
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
  options: { cwd: string }
): Promise<GitCommandResult> {
  try {
    const result = await execFileAsync("git", args, {
      cwd: options.cwd,
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

function commandOutput(error: unknown, key: "stdout" | "stderr"): string {
  if (typeof error === "object" && error !== null) {
    const output = (error as Record<string, unknown>)[key];

    if (typeof output === "string") {
      return output;
    }
  }

  return "";
}
