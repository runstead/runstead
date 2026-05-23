import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDb } from "./runstead-root.js";
import { inspectGitHubRepository } from "./github.js";
import {
  checkStartupGate,
  type StartupGateCheckResult,
  type StartupGateStage
} from "./startup-evidence.js";
import { getStartupStatus } from "./startup-status.js";
import { startupVerdictReady } from "./startup-verdict.js";

const execFileAsync = promisify(execFile);

export interface GenerateStartupCiSummaryOptions {
  cwd?: string;
  domain?: string;
  stage?: StartupGateStage;
  checkName?: string;
  outputDir?: string;
  readiness?: {
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
  event: RunsteadEvent;
}

export interface StartupGitHubCheckRunSummary {
  name: string;
  conclusion: "success" | "failure";
  title: string;
  summary: string;
}

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
    (await readLatestStartupCiReadiness({
      cwd,
      domain,
      now: new Date(checkedAt)
    }));
  const effectiveGate = effectiveStartupCiGate(gate, readiness);
  const remoteActions = await inspectGitHubActionsRemoteStatus({
    cwd,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch })
  });
  const finalGate = mergeRemoteActionsIntoStartupGate(effectiveGate, remoteActions);
  const checkRun = startupCheckRunSummary({
    gate: finalGate,
    checkName: options.checkName ?? "Runstead Startup Gate"
  });
  const releaseGate: StartupReleaseGateSummary = {
    status: finalGate.passed ? "allow_release" : "block_release",
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
      ...(readiness === undefined ? {} : { readinessVerdict: readiness.verdict })
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
    event
  };
}

function mergeRemoteActionsIntoStartupGate(
  gate: StartupGateCheckResult,
  remoteActions: StartupGitHubActionsRemoteStatus
): StartupGateCheckResult {
  const remoteBlockers = remoteActionsReleaseBlockers(remoteActions);
  const remoteWarnings = remoteActionsReleaseWarnings(remoteActions);
  const blockers = uniqueStrings([...gate.blockers, ...remoteBlockers]);

  return {
    ...gate,
    passed: blockers.length === 0,
    blockers,
    warnings: uniqueStrings([...gate.warnings, ...remoteWarnings])
  };
}

function remoteActionsReleaseBlockers(
  remoteActions: StartupGitHubActionsRemoteStatus
): string[] {
  if (remoteActions.status === "failed") {
    return [
      `remote GitHub Actions failed for HEAD${remoteActions.workflowName === undefined ? "" : ` (${remoteActions.workflowName})`}`
    ];
  }

  if (remoteActions.status === "pending") {
    return [
      `remote GitHub Actions are still pending for HEAD${remoteActions.workflowName === undefined ? "" : ` (${remoteActions.workflowName})`}`
    ];
  }

  return [];
}

function remoteActionsReleaseWarnings(
  remoteActions: StartupGitHubActionsRemoteStatus
): string[] {
  if (remoteActions.status === "not_configured") {
    return [`remote GitHub Actions status is not configured: ${remoteActions.reason}`];
  }

  if (remoteActions.status === "unknown") {
    return [`remote GitHub Actions status is unknown: ${remoteActions.reason}`];
  }

  return [];
}

function effectiveStartupCiGate(
  gate: StartupGateCheckResult,
  readiness:
    | {
        verdict: string;
        blockers: string[];
      }
    | undefined
): StartupGateCheckResult {
  if (readiness === undefined) {
    return gate;
  }

  if (startupVerdictReady(readiness.verdict) && readiness.blockers.length === 0) {
    return {
      ...gate,
      passed: true,
      blockers: [],
      warnings: uniqueStrings([
        ...gate.warnings,
        ...gate.blockers.map(
          (blocker) =>
            `startup readiness verdict ${readiness.verdict} superseded gate blocker: ${blocker}`
        )
      ])
    };
  }

  const blockers = uniqueStrings([...gate.blockers, ...readiness.blockers]);

  return {
    ...gate,
    passed: blockers.length === 0,
    blockers
  };
}

async function readLatestStartupCiReadiness(input: {
  cwd: string;
  domain: string;
  now: Date;
}): Promise<{ verdict: string; blockers: string[] } | undefined> {
  try {
    const status = await getStartupStatus({
      cwd: input.cwd,
      domain: input.domain,
      now: input.now
    });

    return status.readiness === undefined
      ? undefined
      : {
          verdict: status.readiness.verdict,
          blockers: status.readiness.blockers
        };
  } catch {
    return undefined;
  }
}

export function formatStartupCiSummary(result: GenerateStartupCiSummaryResult): string {
  return [
    "Startup CI integration",
    `Stage: ${result.stage}`,
    `Check: ${result.checkRun.name}`,
    `Conclusion: ${result.checkRun.conclusion}`,
    `Remote GitHub Actions: ${result.remoteActions.status}`,
    `Release gate: ${result.releaseGate.status}`,
    `JSON artifact: ${result.jsonPath}`,
    `PR comment: ${result.markdownPath}`
  ].join("\n");
}

function startupCheckRunSummary(input: {
  gate: StartupGateCheckResult;
  checkName: string;
}): StartupGitHubCheckRunSummary {
  return {
    name: input.checkName,
    conclusion: input.gate.passed ? "success" : "failure",
    title: input.gate.passed
      ? `${input.gate.stage} gate passed`
      : `${input.gate.stage} gate blocked`,
    summary:
      input.gate.blockers.length === 0
        ? "Runstead found no startup gate blockers."
        : `${input.gate.blockers.length} blocker(s): ${input.gate.blockers.slice(0, 5).join("; ")}`
  };
}

function formatStartupPrComment(input: {
  gate: StartupGateCheckResult;
  checkRun: StartupGitHubCheckRunSummary;
  remoteActions: StartupGitHubActionsRemoteStatus;
  releaseGate: StartupReleaseGateSummary;
}): string {
  return [
    "## Runstead Startup Gate",
    "",
    `**${input.checkRun.title}**`,
    "",
    `- Check conclusion: \`${input.checkRun.conclusion}\``,
    `- Remote GitHub Actions: \`${formatRemoteActionsStatus(input.remoteActions)}\``,
    `- Release gate: \`${input.releaseGate.status}\``,
    `- Gate event: \`${input.gate.event.eventId}\``,
    "",
    "### Blockers",
    input.gate.blockers.length === 0
      ? "- none"
      : input.gate.blockers.map((blocker) => `- ${blocker}`).join("\n"),
    "",
    "### Warnings",
    input.gate.warnings.length === 0
      ? "- none"
      : input.gate.warnings.map((warning) => `- ${warning}`).join("\n"),
    "",
    "### Remote Failure Log",
    input.remoteActions.failedJobLogExcerpt === undefined
      ? "- none"
      : [
          `- Job: ${input.remoteActions.failedJobName ?? "unknown"}`,
          ...(input.remoteActions.failedJobLogUrl === undefined
            ? []
            : [`- Log source: ${input.remoteActions.failedJobLogUrl}`]),
          "",
          "```text",
          input.remoteActions.failedJobLogExcerpt,
          "```"
        ].join("\n"),
    "",
    "### Branch Protection",
    input.releaseGate.branchProtectionHint
  ].join("\n");
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
          : "origin remote is not a GitHub repository"
    };
  }

  const headSha = await readGitHead(input.cwd);

  if (headSha === undefined) {
    return {
      status: "unknown",
      repository: `${repository.repository.owner}/${repository.repository.repo}`,
      reason: "git HEAD is unavailable"
    };
  }

  const fetcher = input.fetch ?? globalThis.fetch;

  if (fetcher === undefined) {
    return {
      status: "unknown",
      repository: `${repository.repository.owner}/${repository.repository.repo}`,
      headSha,
      reason: "fetch API is unavailable"
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
      return {
        status: "unknown",
        repository: `${repository.repository.owner}/${repository.repository.repo}`,
        headSha,
        reason: `GitHub Actions API returned HTTP ${response.status}`
      };
    }

    const body = await response.json();
    const run = latestGitHubActionsRun(body);

    if (run === undefined) {
      return {
        status: "unknown",
        repository: `${repository.repository.owner}/${repository.repository.repo}`,
        headSha,
        reason: "no GitHub Actions workflow run was found for HEAD"
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
      ...(failedJob === undefined ? {} : failedJob)
    };
  } catch (error) {
    return {
      status: "unknown",
      repository: `${repository.repository.owner}/${repository.repository.repo}`,
      headSha,
      reason: error instanceof Error ? error.message : String(error)
    };
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
  const start = failureIndex < 0 ? Math.max(0, lines.length - 20) : Math.max(0, failureIndex - 8);

  return lines.slice(start, start + 24).join("\n").slice(0, 4_000);
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

function formatRemoteActionsStatus(status: StartupGitHubActionsRemoteStatus): string {
  return [
    status.status,
    status.repository === undefined ? undefined : `repo=${status.repository}`,
    status.headSha === undefined ? undefined : `head=${status.headSha.slice(0, 12)}`,
    status.workflowRunId === undefined ? undefined : `run=${status.workflowRunId}`,
    status.workflowName === undefined ? undefined : `workflow=${status.workflowName}`,
    status.conclusion === undefined ? undefined : `conclusion=${status.conclusion}`,
    status.failedJobName === undefined ? undefined : `failed_job=${status.failedJobName}`,
    status.reason === undefined ? undefined : `reason=${status.reason}`
  ]
    .filter((part): part is string => part !== undefined)
    .join("; ");
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
