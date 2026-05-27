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
export { taskGitDiffBase, taskGitDiffStaged } from "./git-task-options.js";

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
