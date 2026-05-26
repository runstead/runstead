import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import {
  compileReadinessReleaseDecision,
  type ReadinessTarget,
  type ReadinessExternalCheck,
  type ReadinessReleaseDecision
} from "@runstead/runtime";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDb } from "./runstead-root.js";
import { inspectGitHubRepository } from "./github.js";
import {
  checkStartupGate,
  type StartupGateCheckResult,
  type StartupGateStage
} from "./startup-evidence.js";
import { formatStartupPrComment, startupCheckRunSummary } from "./startup-ci-format.js";
import { readLatestStartupReadinessSnapshot } from "./startup-readiness-snapshot.js";

export { formatStartupCiSummary } from "./startup-ci-format.js";

const execFileAsync = promisify(execFile);

export interface GenerateStartupCiSummaryOptions {
  cwd?: string;
  domain?: string;
  stage?: StartupGateStage;
  checkName?: string;
  outputDir?: string;
  readiness?: {
    target?: string;
    verdict: string;
    blockers: string[];
  };
  fetch?: FetchLike;
  now?: Date;
}

export interface GenerateStartupCiSummaryResult {
  root: string;
  stateDb: string;
  stage: StartupGateStage;
  gate: StartupGateCheckResult;
  markdownPath: string;
  jsonPath: string;
  checkRun: StartupGitHubCheckRunSummary;
  remoteActions: StartupGitHubActionsRemoteStatus;
  prComment: string;
  releaseGate: StartupReleaseGateSummary;
  releaseDecision: ReadinessReleaseDecision;
  event: RunsteadEvent;
}

export interface StartupGitHubCheckRunSummary {
  name: string;
  conclusion: "success" | "failure";
  title: string;
  summary: string;
}

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

export interface StartupReleaseGateSummary {
  status: "allow_release" | "block_release";
  requiredArtifact: string;
  branchProtectionHint: string;
}

const STARTUP_DOMAIN = "ai-native-startup";
type FetchLike = (
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

export async function generateStartupCiSummary(
  options: GenerateStartupCiSummaryOptions = {}
): Promise<GenerateStartupCiSummaryResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const domain = options.domain ?? STARTUP_DOMAIN;
  const stage = options.stage ?? "launch";
  const checkedAt = (options.now ?? new Date()).toISOString();
  const resolvedState = await requireRunsteadStateDb(cwd);
  const outputDir = resolve(options.outputDir ?? join(resolvedState.root, "reports"));
  const gate = await checkStartupGate({
    cwd,
    domain,
    stage,
    now: new Date(checkedAt)
  });
  const readiness =
    options.readiness ??
    readLatestStartupReadinessSnapshot({
      root: resolvedState.root,
      stateDb: resolvedState.stateDb
    });
  const remoteActions = await inspectGitHubActionsRemoteStatus({
    cwd,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch })
  });
  const remoteCiTarget = readinessTargetForRemoteCi(readiness);
  const releaseDecision = compileReadinessReleaseDecision({
    gate,
    ...(readiness === undefined ? {} : { readiness }),
    externalChecks: [remoteActionsReadinessCheck(remoteActions, remoteCiTarget)]
  });
  const finalGate = startupGateFromReleaseDecision(gate, releaseDecision);
  const checkRun = startupCheckRunSummary({
    gate: finalGate,
    checkName: options.checkName ?? "Runstead Startup Gate"
  });
  const releaseGate: StartupReleaseGateSummary = {
    status: releaseDecision.status,
    requiredArtifact: "runstead-startup-ci-summary.json",
    branchProtectionHint:
      "Configure CI to fail this step when conclusion is failure, require the check in branch protection, and treat failed remote GitHub Actions as release blockers."
  };
  const prComment = formatStartupPrComment({
    gate: finalGate,
    checkRun,
    remoteActions,
    releaseGate
  });
  const jsonPath = join(outputDir, "runstead-startup-ci-summary.json");
  const markdownPath = join(outputDir, "runstead-startup-ci-summary.md");
  const payload = {
    generatedAt: checkedAt,
    domain,
    stage,
    checkRun,
    remoteActions,
    releaseGate,
    releaseDecision,
    prComment,
    gate: {
      passed: gate.passed,
      blockers: gate.blockers,
      warnings: gate.warnings,
      findings: gate.findings,
      diff: gate.diff,
      eventId: gate.event.eventId
    },
    effectiveGate: {
      passed: finalGate.passed,
      blockers: finalGate.blockers,
      warnings: finalGate.warnings,
      findings: finalGate.findings,
      diff: finalGate.diff,
      eventId: finalGate.event.eventId,
      ...(releaseDecision.readinessVerdict === undefined
        ? {}
        : { readinessVerdict: releaseDecision.readinessVerdict }),
      supersededGateBlockers: releaseDecision.supersededGateBlockers,
      externalChecks: releaseDecision.externalChecks
    }
  };
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "startup_ci.summary_generated",
    aggregateType: "startup_ci",
    aggregateId: `${domain}_${stage}`,
    payload,
    createdAt: checkedAt
  };
  const database = openRunsteadDatabase(resolvedState.stateDb);

  try {
    await mkdir(outputDir, { recursive: true });
    await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await writeFile(markdownPath, prComment, "utf8");
    appendEventAndProject(database, { event });
  } finally {
    database.close();
  }

  return {
    root: resolvedState.root,
    stateDb: resolvedState.stateDb,
    stage,
    gate: finalGate,
    markdownPath,
    jsonPath,
    checkRun,
    remoteActions,
    prComment,
    releaseGate,
    releaseDecision,
    event
  };
}

function remoteActionsReadinessCheck(
  remoteActions: StartupGitHubActionsRemoteStatus,
  target: ReadinessTarget
): ReadinessExternalCheck {
  if (remoteActions.status === "failed") {
    return {
      id: "github_actions",
      status: "failed",
      blocker: `remote GitHub Actions failed for HEAD${remoteActions.workflowName === undefined ? "" : ` (${remoteActions.workflowName})`}`
    };
  }

  if (remoteActions.status === "pending") {
    return {
      id: "github_actions",
      status: "pending",
      blocker: `remote GitHub Actions are still pending for HEAD${remoteActions.workflowName === undefined ? "" : ` (${remoteActions.workflowName})`}`
    };
  }

  if (remoteActions.status === "not_configured") {
    const message = remoteActionsDiagnosticMessage(remoteActions);

    if (target !== "local") {
      return {
        id: "github_actions",
        status: "failed",
        blocker: `${message}; ${target} target requires confirmed remote GitHub Actions.`
      };
    }

    return {
      id: "github_actions",
      status: "not_configured",
      warning: `${message}; local target treats remote GitHub Actions as advisory.`
    };
  }

  if (remoteActions.status === "unknown") {
    const message = remoteActionsDiagnosticMessage(remoteActions);

    if (target !== "local") {
      return {
        id: "github_actions",
        status: "failed",
        blocker: `${message}; ${target} target requires confirmed remote GitHub Actions.`
      };
    }

    return {
      id: "github_actions",
      status: "unknown",
      warning: `${message}; local target treats remote GitHub Actions as advisory.`
    };
  }

  return {
    id: "github_actions",
    status: "passed"
  };
}

function readinessTargetForRemoteCi(
  readiness:
    | {
        target?: string;
        verdict: string;
      }
    | undefined
): ReadinessTarget {
  if (
    readiness?.target === "local" ||
    readiness?.target === "staging" ||
    readiness?.target === "production"
  ) {
    return readiness.target;
  }

  if (readiness?.verdict.startsWith("local_")) {
    return "local";
  }

  if (readiness?.verdict.startsWith("staging_")) {
    return "staging";
  }

  if (readiness?.verdict.startsWith("public_")) {
    return "production";
  }

  return "production";
}

function remoteActionsDiagnosticMessage(
  remoteActions: StartupGitHubActionsRemoteStatus
): string {
  const availability =
    remoteActions.status === "not_configured" ? "not configured" : "unknown";
  const details = [
    `remote GitHub Actions status is ${availability}`,
    remoteActions.reason === undefined ? undefined : `reason: ${remoteActions.reason}`,
    remoteActions.diagnosis === undefined
      ? undefined
      : `likely cause: ${remoteActions.diagnosis}`,
    remoteActions.setupAction === undefined
      ? undefined
      : `setup action: ${remoteActions.setupAction}`
  ].filter((part): part is string => part !== undefined);

  return details.join("; ");
}

function startupGateFromReleaseDecision(
  gate: StartupGateCheckResult,
  decision: ReadinessReleaseDecision
): StartupGateCheckResult {
  return {
    ...gate,
    passed: decision.passed,
    blockers: decision.blockers,
    warnings: decision.warnings
  };
}

async function inspectGitHubActionsRemoteStatus(input: {
  cwd: string;
  fetch?: FetchLike;
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

async function diagnoseGitHubActionsHttpResponse(
  response: Awaited<ReturnType<FetchLike>>
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

async function safeResponseText(
  response: Awaited<ReturnType<FetchLike>>
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

async function fetchFailedGitHubActionsJobLog(input: {
  fetcher: FetchLike;
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

function latestGitHubActionsRun(body: unknown): Record<string, unknown> | undefined {
  if (!isRecord(body) || !Array.isArray(body.workflow_runs)) {
    return undefined;
  }

  return body.workflow_runs.find(isRecord);
}

function githubActionsHeaders(): Record<string, string> {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function stringIdValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}
