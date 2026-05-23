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
  workflowName?: string;
  workflowRunUrl?: string;
  runStatus?: string;
  conclusion?: string;
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
  const effectiveGate = effectiveStartupCiGate(gate, options.readiness);
  const checkRun = startupCheckRunSummary({
    gate: effectiveGate,
    checkName: options.checkName ?? "Runstead Startup Gate"
  });
  const remoteActions = await inspectGitHubActionsRemoteStatus({
    cwd,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch })
  });
  const releaseGate: StartupReleaseGateSummary = {
    status: effectiveGate.passed ? "allow_release" : "block_release",
    requiredArtifact: "runstead-startup-ci-summary.json",
    branchProtectionHint:
      "Configure CI to fail this step when conclusion is failure, then require the check in branch protection."
  };
  const prComment = formatStartupPrComment({
    gate: effectiveGate,
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
      passed: effectiveGate.passed,
      blockers: effectiveGate.blockers,
      warnings: effectiveGate.warnings,
      findings: effectiveGate.findings,
      diff: effectiveGate.diff,
      eventId: effectiveGate.event.eventId,
      ...(options.readiness === undefined
        ? {}
        : { readinessVerdict: options.readiness.verdict })
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
    gate: effectiveGate,
    markdownPath,
    jsonPath,
    checkRun,
    remoteActions,
    prComment,
    releaseGate,
    event
  };
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

  const blockers = uniqueStrings([...gate.blockers, ...readiness.blockers]);

  return {
    ...gate,
    passed: blockers.length === 0,
    blockers
  };
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
    const status =
      runStatus === "completed"
        ? conclusion === "success"
          ? "passed"
          : "failed"
        : "pending";

    return {
      status,
      repository: `${repository.repository.owner}/${repository.repository.repo}`,
      headSha,
      ...(workflowName === undefined ? {} : { workflowName }),
      ...(workflowRunUrl === undefined ? {} : { workflowRunUrl }),
      ...(runStatus === undefined ? {} : { runStatus }),
      ...(conclusion === undefined ? {} : { conclusion })
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
    status.workflowName === undefined ? undefined : `workflow=${status.workflowName}`,
    status.conclusion === undefined ? undefined : `conclusion=${status.conclusion}`,
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
