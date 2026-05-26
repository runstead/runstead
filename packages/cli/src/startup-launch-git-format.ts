import type { StartupLaunchGitSummary } from "./startup-launch-git-types.js";

export function launchGitActions(input: {
  isGitRepo: boolean;
  changedFiles: string[];
  branch: string;
  remoteDetected: boolean;
  githubDetected: boolean;
  ciDetected: boolean;
  suggestedCommitMessage: string;
}): string[] {
  return [
    ...(input.isGitRepo ? [] : ["git init"]),
    ...(input.changedFiles.length === 0
      ? []
      : [
          `git add ${input.changedFiles.map(shellQuote).join(" ")}`,
          `git commit -m ${shellQuote(input.suggestedCommitMessage)}`
        ]),
    ...(input.remoteDetected ? [] : ["git remote add origin <github-repository-url>"]),
    ...(input.ciDetected ? [] : ["runstead startup onboard --write-ci"]),
    ...(input.remoteDetected
      ? [`git push -u origin ${shellQuote(input.branch)}`]
      : ["git push -u origin <branch>"]),
    ...(input.githubDetected
      ? ["gh pr create --fill --draft"]
      : ["create a GitHub PR after origin points to a GitHub repository"])
  ];
}

export function formatStartupLaunchGitSummary(
  summary: StartupLaunchGitSummary
): string {
  return [
    "# Startup Git/GitHub Launch Summary",
    "",
    `Generated: ${summary.generatedAt}`,
    "Git writes executed: no",
    "",
    "## Repository",
    "",
    `- Git repository: ${summary.isGitRepo ? "yes" : "no"}`,
    `- Branch: ${summary.branch ?? "none"}`,
    `- HEAD: ${summary.headSha ?? "none"}`,
    `- Upstream: ${summary.upstream ?? "none"}`,
    `- Ahead/behind: ${summary.ahead ?? 0}/${summary.behind ?? 0}`,
    "",
    "## Working Tree",
    "",
    listOrNone(summary.changedFiles),
    "",
    "## GitHub",
    "",
    `- Remote ${summary.remote.name}: ${summary.remote.detected ? (summary.remote.url ?? "detected") : "missing"}`,
    `- GitHub repository: ${summary.remote.github === undefined ? "missing" : `${summary.remote.github.owner}/${summary.remote.github.repo}`}`,
    "",
    "## CI",
    "",
    `- CI detected: ${summary.ciDetected ? "yes" : "no"}`,
    `- Providers: ${summary.ciProviders.length === 0 ? "none" : summary.ciProviders.join(", ")}`,
    "",
    "## Suggested Launch Path",
    "",
    listOrNone(summary.launchActions),
    "",
    "## Boundary",
    "",
    "- This summary does not commit, push, or create a PR.",
    "- Commit, push, and GitHub PR creation require explicit user action or a governed Runstead workflow.",
    ""
  ].join("\n");
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

function listOrNone(items: string[]): string {
  return items.length === 0 ? "- none" : items.map((item) => `- ${item}`).join("\n");
}
