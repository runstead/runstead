import { resolve } from "node:path";

import {
  DEFAULT_GITHUB_CLI_TIMEOUT_MS,
  runGitHubCli,
  type GitHubCliCommandResult,
  type GitHubCliRunner
} from "./github-actions.js";

export interface PullRequestEvidenceSummary {
  id: string;
  type: string;
  summary: string;
  uri?: string;
}

export interface CreateGitHubPullRequestOptions {
  cwd?: string;
  title: string;
  body?: string;
  base: string;
  head: string;
  draft?: boolean;
  taskId?: string;
  goalId?: string;
  evidence?: PullRequestEvidenceSummary[];
  authToken?: string;
  timeoutMs?: number;
  runner?: GitHubCliRunner;
}

export interface CreateGitHubPullRequestResult {
  cwd: string;
  title: string;
  base: string;
  head: string;
  url?: string;
  stdout: string;
}

export async function createGitHubPullRequest(
  options: CreateGitHubPullRequestOptions
): Promise<CreateGitHubPullRequestResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const body = buildPullRequestBody(options);
  const args = [
    "pr",
    "create",
    "--title",
    options.title,
    "--body",
    body,
    "--base",
    options.base,
    "--head",
    options.head,
    ...(options.draft === true ? ["--draft"] : [])
  ];
  const result = await (options.runner ?? runGitHubCli)(
    args,
    options.authToken === undefined
      ? {
          cwd,
          timeoutMs: options.timeoutMs ?? DEFAULT_GITHUB_CLI_TIMEOUT_MS
        }
      : {
          cwd,
          timeoutMs: options.timeoutMs ?? DEFAULT_GITHUB_CLI_TIMEOUT_MS,
          env: {
            GH_TOKEN: options.authToken
          }
        }
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `gh pr create failed with exit ${result.exitCode}: ${result.stderr}`
    );
  }

  const url = extractFirstUrl(result);

  return {
    cwd,
    title: options.title,
    base: options.base,
    head: options.head,
    ...(url === undefined ? {} : { url }),
    stdout: result.stdout
  };
}

export function buildPullRequestBody(
  options: Pick<
    CreateGitHubPullRequestOptions,
    "body" | "evidence" | "goalId" | "taskId"
  >
): string {
  const sections = [
    options.body?.trim() ?? "Runstead generated this pull request.",
    metadataSection(options),
    evidenceSection(options.evidence ?? [])
  ].filter((section) => section.length > 0);

  return `${sections.join("\n\n")}\n`;
}

function metadataSection(
  options: Pick<CreateGitHubPullRequestOptions, "goalId" | "taskId">
): string {
  const lines = [
    options.goalId === undefined ? undefined : `- Goal: ${options.goalId}`,
    options.taskId === undefined ? undefined : `- Task: ${options.taskId}`
  ].filter((line): line is string => line !== undefined);

  return lines.length === 0 ? "" : ["## Runstead", ...lines].join("\n");
}

function evidenceSection(evidence: PullRequestEvidenceSummary[]): string {
  if (evidence.length === 0) {
    return "";
  }

  return [
    "## Evidence",
    ...evidence.map((item) =>
      [`- ${item.id} (${item.type}): ${item.summary}`, item.uri]
        .filter((part): part is string => part !== undefined && part.length > 0)
        .join(" ")
    )
  ].join("\n");
}

function extractFirstUrl(result: GitHubCliCommandResult): string | undefined {
  return /https?:\/\/\S+/.exec(result.stdout)?.[0];
}
