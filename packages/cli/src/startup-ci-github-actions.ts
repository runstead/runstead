import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { inspectGitHubRepository } from "./github.js";
import {
  diagnoseGitHubActionsHttpResponse,
  fetchFailedGitHubActionsJobLog,
  githubActionsHeaders,
  latestGitHubActionsRun,
  stringIdValue,
  stringValue
} from "./startup-ci-github-actions-api.js";

const execFileAsync = promisify(execFile);

export type StartupCiFetchLike = (
  input: string,
  init?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
  }
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text?: () => Promise<string>;
}>;

export type StartupGitHubActionsRemoteDiagnosis =
  | "no_github_remote"
  | "not_github_remote"
  | "no_initial_commit"
  | "private_or_unauthenticated"
  | "actions_disabled_or_not_found"
  | "no_token_or_fetch_unavailable"
  | "api_network_error"
  | "no_workflow_run_for_head";

export interface StartupGitHubActionsRemoteStatus {
  status: "passed" | "failed" | "pending" | "not_configured" | "unknown";
  repository?: string;
  headSha?: string;
  workflowRunId?: string;
  workflowName?: string;
  workflowRunUrl?: string;
  runStatus?: string;
  conclusion?: string;
  failedJobName?: string;
  failedJobLogUrl?: string;
  failedJobLogExcerpt?: string;
  reason?: string;
  diagnosis?: StartupGitHubActionsRemoteDiagnosis;
  setupAction?: string;
}

export async function inspectGitHubActionsRemoteStatus(input: {
  cwd: string;
  fetch?: StartupCiFetchLike;
}): Promise<StartupGitHubActionsRemoteStatus> {
  const repository = await inspectGitHubRepository({
    cwd: input.cwd,
    gitTimeoutMs: 5_000
  });

  if (repository.repository === undefined) {
    return {
      status: "not_configured",
      reason:
        repository.remoteUrl === undefined
          ? "GitHub remote is missing"
          : "origin remote is not a GitHub repository",
      diagnosis:
        repository.remoteUrl === undefined ? "no_github_remote" : "not_github_remote",
      setupAction:
        repository.remoteUrl === undefined
          ? "Add a GitHub origin remote and push the branch before relying on remote CI."
          : "Set origin to a GitHub repository or configure a supported remote CI integration."
    };
  }

  const headSha = await readGitHead(input.cwd);

  if (headSha === undefined) {
    return {
      status: "not_configured",
      repository: `${repository.repository.owner}/${repository.repository.repo}`,
      reason: "remote_ci_not_applicable_until_initial_commit",
      diagnosis: "no_initial_commit",
      setupAction:
        "Create and push an initial commit before relying on remote GitHub Actions."
    };
  }

  const fetcher = input.fetch ?? globalThis.fetch;

  if (fetcher === undefined) {
    return {
      status: "unknown",
      repository: `${repository.repository.owner}/${repository.repository.repo}`,
      headSha,
      reason: "fetch API is unavailable",
      diagnosis: "no_token_or_fetch_unavailable",
      setupAction:
        "Run CI summary in a Node runtime with fetch support or provide an authenticated GitHub fetch implementation."
    };
  }

  const url = new URL(
    `https://api.github.com/repos/${repository.repository.owner}/${repository.repository.repo}/actions/runs`
  );
  url.searchParams.set("head_sha", headSha);
  url.searchParams.set("per_page", "10");

  try {
    const response = await fetcher(url.toString(), {
      headers: githubActionsHeaders(),
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      const diagnosis = await diagnoseGitHubActionsHttpResponse(response);

      return {
        status: "unknown",
        repository: `${repository.repository.owner}/${repository.repository.repo}`,
        headSha,
        ...diagnosis
      };
    }

    const body: unknown = await response.json();
    const run = latestGitHubActionsRun(body);

    if (run === undefined) {
      return {
        status: "unknown",
        repository: `${repository.repository.owner}/${repository.repository.repo}`,
        headSha,
        reason: "no GitHub Actions workflow run was found for HEAD",
        diagnosis: "no_workflow_run_for_head",
        setupAction:
          "Push this commit and run the GitHub Actions workflow for HEAD before staging or production release gates."
      };
    }

    const runStatus = stringValue(run.status);
    const conclusion = stringValue(run.conclusion);
    const workflowRunUrl = stringValue(run.html_url);
    const workflowName = stringValue(run.name);
    const workflowRunId = stringIdValue(run.id);
    const status =
      runStatus === "completed"
        ? conclusion === "success"
          ? "passed"
          : "failed"
        : "pending";
    const failedJob =
      status === "failed" && workflowRunId !== undefined
        ? await fetchFailedGitHubActionsJobLog({
            fetcher,
            owner: repository.repository.owner,
            repo: repository.repository.repo,
            workflowRunId
          })
        : undefined;

    return {
      status,
      repository: `${repository.repository.owner}/${repository.repository.repo}`,
      headSha,
      ...(workflowRunId === undefined ? {} : { workflowRunId }),
      ...(workflowName === undefined ? {} : { workflowName }),
      ...(workflowRunUrl === undefined ? {} : { workflowRunUrl }),
      ...(runStatus === undefined ? {} : { runStatus }),
      ...(conclusion === undefined ? {} : { conclusion }),
      ...(failedJob ?? {})
    };
  } catch (error) {
    return {
      status: "unknown",
      repository: `${repository.repository.owner}/${repository.repository.repo}`,
      headSha,
      reason: error instanceof Error ? error.message : String(error),
      diagnosis: "api_network_error",
      setupAction:
        "Retry the GitHub Actions status lookup and check GitHub API/network availability."
    };
  }
}

async function readGitHead(cwd: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd,
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true
    });

    return result.stdout.trim();
  } catch {
    return undefined;
  }
}
