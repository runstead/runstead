import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import {
  compileReadinessReleaseDecision,
  type ReadinessTarget,
  type ReadinessExternalCheck,
  type ReadinessReleaseDecision
} from "@runstead/runtime";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  checkStartupGate,
  type StartupGateCheckResult,
  type StartupGateStage
} from "./startup-evidence.js";
import { formatStartupPrComment, startupCheckRunSummary } from "./startup-ci-format.js";
import {
  inspectGitHubActionsRemoteStatus,
  type StartupCiFetchLike,
  type StartupGitHubActionsRemoteStatus
} from "./startup-ci-github-actions.js";
import { readLatestStartupReadinessSnapshot } from "./startup-readiness-snapshot.js";

export { formatStartupCiSummary } from "./startup-ci-format.js";
export type { StartupGitHubActionsRemoteStatus } from "./startup-ci-github-actions.js";

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
  fetch?: StartupCiFetchLike;
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
