import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { collectRepoInspection } from "./inspection-evidence.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { addStartupEvidence } from "./startup-evidence.js";
import { inspectGitHubRepository } from "./github.js";
import { listGitChangedFiles, redactGitOutput } from "./git-branch.js";

const execFileAsync = promisify(execFile);

export interface GenerateStartupLaunchGitSummaryOptions {
  cwd?: string;
  remote?: string;
  now?: Date;
}

export interface GenerateStartupLaunchGitSummaryResult {
  root: string;
  stateDb: string;
  markdownPath: string;
  jsonPath: string;
  evidenceId: string;
  summary: StartupLaunchGitSummary;
  nextCommands: string[];
}

export interface StartupLaunchGitSummary {
  generatedAt: string;
  isGitRepo: boolean;
  branch?: string;
  headSha?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  changedFiles: string[];
  stagedFiles: string[];
  untrackedFiles: string[];
  remote: {
    name: string;
    detected: boolean;
    url?: string;
    github?: {
      owner: string;
      repo: string;
    };
  };
  ciDetected: boolean;
  ciProviders: string[];
  suggestedCommitMessage: string;
  recommendedBranch: string;
  launchActions: string[];
}

interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function generateStartupLaunchGitSummary(
  options: GenerateStartupLaunchGitSummaryOptions = {}
): Promise<GenerateStartupLaunchGitSummaryResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const remoteName = options.remote ?? "origin";
  const generatedAt = (options.now ?? new Date()).toISOString();
  const state = await requireRunsteadStateDb(cwd);
  const isGitRepo =
    (await runGit(cwd, ["rev-parse", "--is-inside-work-tree"])).stdout.trim() ===
    "true";
  const repo = await collectRepoInspection(cwd, generatedAt);
  const gitHub = await inspectGitHubRepository({ cwd, remote: remoteName });
  const branch = isGitRepo
    ? optionalStdout(await runGit(cwd, ["branch", "--show-current"]))
    : undefined;
  const headSha = isGitRepo
    ? optionalStdout(await runGit(cwd, ["rev-parse", "--verify", "HEAD"]))
    : undefined;
  const upstream =
    isGitRepo && headSha !== undefined
      ? optionalStdout(
          await runGit(cwd, [
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{u}"
          ])
        )
      : undefined;
  const aheadBehind =
    isGitRepo && upstream !== undefined
      ? parseAheadBehind(
          optionalStdout(
            await runGit(cwd, [
              "rev-list",
              "--left-right",
              "--count",
              `${upstream}...HEAD`
            ])
          )
        )
      : { ahead: undefined, behind: undefined };
  const changes = isGitRepo
    ? await listGitChangedFiles({ cwd }).catch(() => ({
        cwd,
        changedFiles: [],
        trackedFiles: [],
        stagedFiles: [],
        untrackedFiles: [],
        excludedFiles: []
      }))
    : {
        cwd,
        changedFiles: [],
        trackedFiles: [],
        stagedFiles: [],
        untrackedFiles: [],
        excludedFiles: []
      };
  const suggestedCommitMessage = "Launch-ready MVP baseline";
  const recommendedBranch = branch ?? "launch/mvp-readiness";
  const summary: StartupLaunchGitSummary = {
    generatedAt,
    isGitRepo,
    ...(branch === undefined ? {} : { branch }),
    ...(headSha === undefined ? {} : { headSha }),
    ...(upstream === undefined ? {} : { upstream }),
    ...(aheadBehind.ahead === undefined ? {} : { ahead: aheadBehind.ahead }),
    ...(aheadBehind.behind === undefined ? {} : { behind: aheadBehind.behind }),
    changedFiles: changes.changedFiles,
    stagedFiles: changes.stagedFiles,
    untrackedFiles: changes.untrackedFiles,
    remote: {
      name: remoteName,
      detected: gitHub.remoteUrl !== undefined,
      ...(gitHub.remoteUrl === undefined ? {} : { url: gitHub.remoteUrl }),
      ...(gitHub.repository === undefined
        ? {}
        : {
            github: {
              owner: gitHub.repository.owner,
              repo: gitHub.repository.repo
            }
          })
    },
    ciDetected: repo.ci.detected,
    ciProviders: repo.ci.providers.map((provider) => provider.provider),
    suggestedCommitMessage,
    recommendedBranch,
    launchActions: launchGitActions({
      isGitRepo,
      changedFiles: changes.changedFiles,
      branch: recommendedBranch,
      remoteDetected: gitHub.remoteUrl !== undefined,
      githubDetected: gitHub.repository !== undefined,
      ciDetected: repo.ci.detected,
      suggestedCommitMessage
    })
  };
  const nextCommands = summary.launchActions;
  const markdown = formatStartupLaunchGitSummary(summary);
  const reportDir = join(state.root, "reports");
  const markdownPath = join(reportDir, "startup-launch-git-summary.md");
  const jsonPath = join(reportDir, "startup-launch-git-summary.json");

  await mkdir(reportDir, { recursive: true });
  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  const evidence = await addStartupEvidence({
    cwd,
    type: "launch_git_path",
    summary: "Git/GitHub launch path summary generated; no git writes executed",
    sourceRefs: [markdownPath, jsonPath],
    sources: [
      {
        kind: "github",
        uri:
          summary.remote.github === undefined
            ? pathToFileURL(markdownPath).href
            : `https://github.com/${summary.remote.github.owner}/${summary.remote.github.repo}`
      }
    ],
    content: JSON.stringify(summary, null, 2),
    now: new Date(generatedAt)
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    markdownPath,
    jsonPath,
    evidenceId: evidence.evidence.id,
    summary,
    nextCommands
  };
}

function launchGitActions(input: {
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

function formatStartupLaunchGitSummary(summary: StartupLaunchGitSummary): string {
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

async function runGit(cwd: string, args: string[]): Promise<GitCommandResult> {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      timeout: 30_000,
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
      stderr: redactGitOutput(commandOutput(error, "stderr")),
      exitCode: commandExitCode(error)
    };
  }
}

function optionalStdout(result: GitCommandResult): string | undefined {
  if (result.exitCode !== 0) {
    return undefined;
  }

  const value = result.stdout.trim();

  return value.length === 0 ? undefined : value;
}

function parseAheadBehind(value: string | undefined): {
  ahead?: number;
  behind?: number;
} {
  const [behindRaw, aheadRaw] = value?.split(/\s+/) ?? [];
  const ahead = Number(aheadRaw);
  const behind = Number(behindRaw);

  return {
    ...(Number.isFinite(ahead) ? { ahead } : {}),
    ...(Number.isFinite(behind) ? { behind } : {})
  };
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

function listOrNone(items: string[]): string {
  return items.length === 0 ? "- none" : items.map((item) => `- ${item}`).join("\n");
}

function commandOutput(error: unknown, key: "stdout" | "stderr"): string {
  if (typeof error === "object" && error !== null) {
    const value = (error as Record<string, unknown>)[key];

    if (typeof value === "string") {
      return value;
    }
  }

  return "";
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
