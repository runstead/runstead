import type { Task } from "@runstead/core";

import type { ShellCommandResult } from "../shell-executor.js";

export function taskGitDiffStaged(task: Task): boolean | undefined {
  const value = task.input.gitDiffStaged;

  return typeof value === "boolean" ? value : undefined;
}

export function taskGitDiffBase(task: Task): string | undefined {
  const value = task.input.gitDiffBase;

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function gitDiffCommand(input: {
  path: string | undefined;
  staged: boolean;
  base: string | undefined;
}): string {
  const base = input.staged
    ? "git diff --staged"
    : input.base === undefined
      ? "git diff"
      : `git diff --end-of-options ${shellQuote(
          `${safeGitRevision(input.base, "base")}...HEAD`
        )}`;

  return input.path === undefined ? base : `${base} -- ${shellQuote(input.path)}`;
}

export function gitDiffSummaryCommand(
  mode: "--numstat" | "--name-status" | "--shortstat",
  input: {
    path: string | undefined;
    staged: boolean;
    base: string | undefined;
  }
): string {
  const base = input.staged
    ? `git diff --staged ${mode}`
    : input.base === undefined
      ? `git diff ${mode}`
      : `git diff ${mode} --end-of-options ${shellQuote(
          `${safeGitRevision(input.base, "base")}...HEAD`
        )}`;

  return input.path === undefined ? base : `${base} -- ${shellQuote(input.path)}`;
}

export function mergeDiffSummaryRows(input: { numstat: string; nameStatus: string }): {
  path: string;
  status?: string;
  additions: number | "binary";
  deletions: number | "binary";
}[] {
  const statuses = new Map<string, string>();

  for (const line of input.nameStatus.split(/\r?\n/)) {
    if (line.length === 0) {
      continue;
    }

    const [status, ...paths] = line.split("\t");
    const path = paths.at(-1);

    if (status !== undefined && path !== undefined) {
      statuses.set(path, status);
    }
  }

  return input.numstat
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      const [added = "0", deleted = "0", path = ""] = line.split("\t");
      const additions = added === "-" ? "binary" : Number.parseInt(added, 10);
      const deletions = deleted === "-" ? "binary" : Number.parseInt(deleted, 10);
      const status = statuses.get(path);

      return {
        path,
        ...(status === undefined ? {} : { status }),
        additions:
          additions === "binary" ? "binary" : Number.isNaN(additions) ? 0 : additions,
        deletions:
          deletions === "binary" ? "binary" : Number.isNaN(deletions) ? 0 : deletions
      };
    });
}

export function diffSummaryTotals(
  files: {
    additions: number | "binary";
    deletions: number | "binary";
  }[]
): { files: number; additions: number; deletions: number; binaryFiles: number } {
  const totals = {
    files: 0,
    additions: 0,
    deletions: 0,
    binaryFiles: 0
  };

  for (const file of files) {
    totals.files += 1;

    if (file.additions === "binary" || file.deletions === "binary") {
      totals.binaryFiles += 1;
    }

    if (file.additions !== "binary") {
      totals.additions += file.additions;
    }

    if (file.deletions !== "binary") {
      totals.deletions += file.deletions;
    }
  }

  return totals;
}

export function firstNonZeroExitCode(results: ShellCommandResult[]): number {
  return results.find((result) => result.exitCode !== 0)?.exitCode ?? 0;
}

export function gitLogCommand(input: {
  range: string | undefined;
  path: string | undefined;
  maxCommits: number;
}): string {
  const parts = [
    "git log",
    `--max-count=${input.maxCommits}`,
    "--date=iso-strict",
    "--pretty=format:%H%x1f%an%x1f%ae%x1f%aI%x1f%s"
  ];

  if (input.range !== undefined) {
    parts.push("--end-of-options", shellQuote(safeGitRevision(input.range, "range")));
  }

  if (input.path !== undefined) {
    parts.push("--", shellQuote(input.path));
  }

  return parts.join(" ");
}

export function gitShowCommand(input: {
  ref: string;
  path: string | undefined;
}): string {
  const parts = [
    "git show",
    "--stat",
    "--patch",
    "--find-renames",
    "--format=fuller",
    "--end-of-options",
    shellQuote(safeGitRevision(input.ref, "ref"))
  ];

  if (input.path !== undefined) {
    parts.push("--", shellQuote(input.path));
  }

  return parts.join(" ");
}

export function parseGitLogOutput(stdout: string): {
  sha: string;
  authorName: string;
  authorEmail: string;
  date: string;
  subject: string;
}[] {
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha = "", authorName = "", authorEmail = "", date = "", subject = ""] =
        line.split("\u001f");

      return {
        sha,
        authorName,
        authorEmail,
        date,
        subject
      };
    });
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function safeGitRevision(
  value: string,
  field: "base" | "range" | "ref"
): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`Git revision argument ${field} must not be empty`);
  }

  if (trimmed.startsWith("-")) {
    throw new Error(`Git revision argument ${field} must not start with '-'`);
  }

  return trimmed;
}
