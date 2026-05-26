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
import {
  formatStartupLaunchGitSummary,
  launchGitActions
} from "./startup-launch-git-format.js";
import type {
  GenerateStartupLaunchGitSummaryOptions,
  GenerateStartupLaunchGitSummaryResult,
  StartupLaunchGitSummary
} from "./startup-launch-git-types.js";

const execFileAsync = promisify(execFile);

export type {
  GenerateStartupLaunchGitSummaryOptions,
  GenerateStartupLaunchGitSummaryResult,
  StartupLaunchGitSummary
} from "./startup-launch-git-types.js";

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
