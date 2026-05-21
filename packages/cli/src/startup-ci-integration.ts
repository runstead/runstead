import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  checkStartupGate,
  type StartupGateCheckResult,
  type StartupGateStage
} from "./startup-evidence.js";

export interface GenerateStartupCiSummaryOptions {
  cwd?: string;
  domain?: string;
  stage?: StartupGateStage;
  checkName?: string;
  outputDir?: string;
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

export interface StartupReleaseGateSummary {
  status: "allow_release" | "block_release";
  requiredArtifact: string;
  branchProtectionHint: string;
}

const STARTUP_DOMAIN = "ai-native-startup";

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
  const checkRun = startupCheckRunSummary({
    gate,
    checkName: options.checkName ?? "Runstead Startup Gate"
  });
  const releaseGate: StartupReleaseGateSummary = {
    status: gate.passed ? "allow_release" : "block_release",
    requiredArtifact: "runstead-startup-ci-summary.json",
    branchProtectionHint:
      "Configure CI to fail this step when conclusion is failure, then require the check in branch protection."
  };
  const prComment = formatStartupPrComment({
    gate,
    checkRun,
    releaseGate
  });
  const jsonPath = join(outputDir, "runstead-startup-ci-summary.json");
  const markdownPath = join(outputDir, "runstead-startup-ci-summary.md");
  const payload = {
    generatedAt: checkedAt,
    domain,
    stage,
    checkRun,
    releaseGate,
    prComment,
    gate: {
      passed: gate.passed,
      blockers: gate.blockers,
      warnings: gate.warnings,
      findings: gate.findings,
      diff: gate.diff,
      eventId: gate.event.eventId
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
    gate,
    markdownPath,
    jsonPath,
    checkRun,
    prComment,
    releaseGate,
    event
  };
}

export function formatStartupCiSummary(result: GenerateStartupCiSummaryResult): string {
  return [
    "Startup CI integration",
    `Stage: ${result.stage}`,
    `Check: ${result.checkRun.name}`,
    `Conclusion: ${result.checkRun.conclusion}`,
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
  releaseGate: StartupReleaseGateSummary;
}): string {
  return [
    "## Runstead Startup Gate",
    "",
    `**${input.checkRun.title}**`,
    "",
    `- Check conclusion: \`${input.checkRun.conclusion}\``,
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
