import type { GitCommandResult } from "./git-branch-types.js";

export function normalizeBranchName(branchName: string): string {
  return branchName
    .split("/")
    .map((segment) => normalizeBranchSegment(segment))
    .filter((segment) => segment.length > 0)
    .join("/");
}

export function normalizeBranchSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\.+$/g, "");

  return normalized.length === 0 ? "unnamed" : normalized;
}

export function assertGitCommand(result: GitCommandResult, description: string): void {
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

export function commandOutput(error: unknown, key: "stdout" | "stderr"): string {
  if (typeof error === "object" && error !== null) {
    const output = (error as Record<string, unknown>)[key];

    if (typeof output === "string") {
      return output;
    }
  }

  return "";
}

export function commandExitCode(error: unknown): number {
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

export function parsePathLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

export function isCommitExcludedPath(path: string): boolean {
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
