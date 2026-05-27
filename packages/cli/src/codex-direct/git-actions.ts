import type { Task } from "@runstead/core";

export {
  gitDiffCommand,
  gitDiffSummaryCommand,
  gitLogCommand,
  gitShowCommand,
  safeGitRevision,
  shellQuote
} from "./git-command-builders.js";
export {
  diffSummaryTotals,
  firstNonZeroExitCode,
  mergeDiffSummaryRows
} from "./git-diff-summary.js";

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
