import type {
  StartupCiFetchLike,
  StartupGitHubActionsRemoteStatus
} from "./startup-ci-github-actions.js";

export async function diagnoseGitHubActionsHttpResponse(
  response: Awaited<ReturnType<StartupCiFetchLike>>
): Promise<
  Pick<StartupGitHubActionsRemoteStatus, "reason" | "diagnosis" | "setupAction">
> {
  const bodyText = await safeResponseText(response);
  const lowerBody = bodyText.toLowerCase();

  if (
    response.status === 410 ||
    (lowerBody.includes("actions") &&
      (lowerBody.includes("disabled") || lowerBody.includes("not enabled")))
  ) {
    return {
      reason: `GitHub Actions API returned HTTP ${response.status}`,
      diagnosis: "actions_disabled_or_not_found",
      setupAction:
        "Enable GitHub Actions for the repository and make sure at least one workflow runs on this branch."
    };
  }

  if ([401, 403, 404].includes(response.status)) {
    return {
      reason: `GitHub Actions API returned HTTP ${response.status}`,
      diagnosis: "private_or_unauthenticated",
      setupAction:
        "Authenticate GitHub API access with GITHUB_TOKEN or GH_TOKEN and confirm the repository exists and is accessible."
    };
  }

  return {
    reason: `GitHub Actions API returned HTTP ${response.status}`,
    diagnosis: "api_network_error",
    setupAction:
      "Retry the GitHub Actions status lookup and inspect the GitHub API response for this repository."
  };
}

export async function fetchFailedGitHubActionsJobLog(input: {
  fetcher: StartupCiFetchLike;
  owner: string;
  repo: string;
  workflowRunId: string;
}): Promise<
  | Pick<
      StartupGitHubActionsRemoteStatus,
      "failedJobName" | "failedJobLogUrl" | "failedJobLogExcerpt"
    >
  | undefined
> {
  const jobsUrl = new URL(
    `https://api.github.com/repos/${input.owner}/${input.repo}/actions/runs/${input.workflowRunId}/jobs`
  );
  jobsUrl.searchParams.set("filter", "latest");
  jobsUrl.searchParams.set("per_page", "100");

  try {
    const jobsResponse = await input.fetcher(jobsUrl.toString(), {
      headers: githubActionsHeaders(),
      signal: AbortSignal.timeout(10_000)
    });

    if (!jobsResponse.ok) {
      return undefined;
    }

    const body = await jobsResponse.json();
    const job = firstFailedGitHubJob(body);

    if (job === undefined) {
      return undefined;
    }

    const jobId = stringIdValue(job.id);

    if (jobId === undefined) {
      return undefined;
    }

    const logUrl = `https://api.github.com/repos/${input.owner}/${input.repo}/actions/jobs/${jobId}/logs`;
    const logResponse = await input.fetcher(logUrl, {
      headers: githubActionsHeaders(),
      signal: AbortSignal.timeout(10_000)
    });

    if (!logResponse.ok || logResponse.text === undefined) {
      return {
        failedJobName: stringValue(job.name) ?? jobId,
        failedJobLogUrl: logUrl
      };
    }

    const log = await logResponse.text();

    return {
      failedJobName: stringValue(job.name) ?? jobId,
      failedJobLogUrl: logUrl,
      failedJobLogExcerpt: failedLogExcerpt(log)
    };
  } catch {
    return undefined;
  }
}

export function latestGitHubActionsRun(
  body: unknown
): Record<string, unknown> | undefined {
  if (!isRecord(body) || !Array.isArray(body.workflow_runs)) {
    return undefined;
  }

  return body.workflow_runs.find(isRecord);
}

export function githubActionsHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "runstead-startup-ci",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token === undefined || token.trim().length === 0
      ? {}
      : { Authorization: `Bearer ${token.trim()}` })
  };
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function stringIdValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

async function safeResponseText(
  response: Awaited<ReturnType<StartupCiFetchLike>>
): Promise<string> {
  if (response.text === undefined) {
    return "";
  }

  try {
    return await response.text();
  } catch {
    return "";
  }
}

function firstFailedGitHubJob(body: unknown): Record<string, unknown> | undefined {
  if (!isRecord(body) || !Array.isArray(body.jobs)) {
    return undefined;
  }

  return body.jobs.filter(isRecord).find((job) => {
    const conclusion = stringValue(job.conclusion);

    return (
      conclusion !== undefined &&
      !["success", "skipped", "neutral"].includes(conclusion)
    );
  });
}

function failedLogExcerpt(log: string): string {
  const lines = log
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const failureIndex = lines.findIndex((line) =>
    /(^|\s)(error|failed|failure|exception|timed out|exit code)(\s|:|$)/i.test(line)
  );
  const start =
    failureIndex < 0 ? Math.max(0, lines.length - 20) : Math.max(0, failureIndex - 8);

  return lines
    .slice(start, start + 24)
    .join("\n")
    .slice(0, 4_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
