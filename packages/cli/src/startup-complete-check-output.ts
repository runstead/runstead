import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import type { JsonObject, RunsteadEvent } from "@runstead/core";

import {
  STARTUP_STRUCTURED_ARTIFACT_SCHEMA,
  STARTUP_STRUCTURED_ARTIFACT_SCHEMA_VERSION
} from "./startup-artifacts.js";
import type { GenerateStartupCiSummaryResult } from "./startup-ci-integration.js";
import type {
  StartupCompleteProductBlockerAudit,
  StartupCompleteProductCheckResult,
  StartupCompleteProductCriterion,
  StartupCompleteProductStatus
} from "./startup-complete-check.js";
import type { LaunchReadinessReportResult } from "./launch-readiness-report.js";
import type { OpsDiagnosticsBundleResult } from "./ops-diagnostics.js";
import type { GenerateStartupRemediationPlanResult } from "./startup-remediation.js";

export function formatStartupCompleteProductCheck(
  result: StartupCompleteProductCheckResult
): string {
  return [
    "# Runstead Startup Complete Product Check",
    "",
    `Domain: ${result.domain}`,
    `Generated: ${result.generatedAt}`,
    `Status: ${result.status}`,
    `Score: ${Math.round(result.score * 100)}%`,
    `Evidence: ${result.evidenceId}`,
    `Event: ${result.event.eventId}`,
    "",
    "## Criteria",
    "",
    ...result.criteria.flatMap((criterion) => [
      `### ${criterion.title}`,
      "",
      `- Status: ${criterion.status}`,
      `- Severity: ${criterion.severity}`,
      `- Evidence: ${criterion.evidence.length === 0 ? "none" : criterion.evidence.join("; ")}`,
      `- Missing: ${criterion.missing.length === 0 ? "none" : criterion.missing.join("; ")}`,
      `- Next action: ${criterion.nextAction}`,
      ""
    ]),
    "## Blocker Accountability",
    "",
    listOrNone(
      result.blockers,
      (blocker) =>
        `- [${blocker.severity}] ${blocker.blocker}; owner=${blocker.owner}; remediation=${blocker.remediationTask}; sources=${blocker.evidenceSources.join(", ")}`
    ),
    "",
    "## Review Surfaces",
    "",
    ...Object.entries(result.surfaces).map(([key, value]) => `- ${key}: ${value}`),
    ""
  ].join("\n");
}

export function startupCompleteProductJson(input: {
  result: StartupCompleteProductCheckResult;
  launchReport: LaunchReadinessReportResult;
  ci: GenerateStartupCiSummaryResult;
  remediation: GenerateStartupRemediationPlanResult;
  diagnostics: OpsDiagnosticsBundleResult;
}): JsonObject {
  return {
    schemaVersion: STARTUP_STRUCTURED_ARTIFACT_SCHEMA_VERSION,
    schema: STARTUP_STRUCTURED_ARTIFACT_SCHEMA,
    kind: "startup_complete_product_check",
    generatedAt: input.result.generatedAt,
    markdownPath: input.result.markdownPath,
    data: {
      domain: input.result.domain,
      status: input.result.status,
      score: input.result.score,
      evidenceId: input.result.evidenceId,
      eventId: input.result.event.eventId,
      criteria: input.result.criteria,
      blockers: input.result.blockers,
      surfaces: input.result.surfaces,
      launchReport: {
        status: input.launchReport.status,
        blockers: input.launchReport.blockers,
        trustSummary: input.launchReport.trustSummary,
        markdownPath: input.launchReport.reportPath,
        jsonPath: input.launchReport.jsonPath
      },
      ci: {
        checkRun: input.ci.checkRun,
        releaseGate: input.ci.releaseGate,
        releaseDecision: input.ci.releaseDecision,
        jsonPath: input.ci.jsonPath,
        markdownPath: input.ci.markdownPath
      },
      remediation: {
        status: input.remediation.status,
        blockers: input.remediation.blockers,
        tasks: input.remediation.tasks.map((item) => ({
          taskId: item.task.id,
          blocker: item.blocker,
          severity: item.severity,
          acceptanceCriteria: item.acceptanceCriteria,
          dependsOn: item.dependsOn
        })),
        plan: input.remediation.plan,
        nextCommands: input.remediation.nextCommands
      },
      diagnostics: {
        markdownPath: input.diagnostics.markdownPath,
        jsonPath: input.diagnostics.jsonPath,
        stateBackupPath: input.diagnostics.stateBackupPath,
        doctorOk: input.diagnostics.summary.doctorOk,
        managerLock: input.diagnostics.summary.managerLock,
        retention: input.diagnostics.summary.retention
      }
    }
  };
}

export function startupCompleteProductEvent(input: {
  eventId: string;
  domain: string;
  generatedAt: string;
  status: StartupCompleteProductStatus;
  score: number;
  markdownPath: string;
  jsonPath: string;
  evidenceId: string;
  criteria: StartupCompleteProductCriterion[];
  blockers: StartupCompleteProductBlockerAudit[];
  launchReport: LaunchReadinessReportResult;
  ci: GenerateStartupCiSummaryResult;
  remediation: GenerateStartupRemediationPlanResult;
  diagnostics: OpsDiagnosticsBundleResult;
}): RunsteadEvent {
  const payload = {
    domain: input.domain,
    status: input.status,
    score: input.score,
    evidenceId: input.evidenceId,
    uri: pathToFileURL(input.markdownPath).href,
    jsonUri: pathToFileURL(input.jsonPath).href,
    criteria: input.criteria.map((criterion) => ({
      id: criterion.id,
      status: criterion.status,
      severity: criterion.severity
    })),
    blockers: input.blockers,
    surfaces: {
      launchReportMarkdown: input.launchReport.reportPath,
      launchReportJson: input.launchReport.jsonPath,
      ciMarkdown: input.ci.markdownPath,
      ciJson: input.ci.jsonPath,
      releaseDecision: input.ci.releaseDecision.status,
      readinessVerdict: input.ci.releaseDecision.readinessVerdict ?? "not_evaluated",
      diagnosticsMarkdown: input.diagnostics.markdownPath,
      diagnosticsJson: input.diagnostics.jsonPath,
      remediationStatus: input.remediation.status
    }
  } as JsonObject;

  return {
    eventId: input.eventId,
    type: "startup_complete_product.checked",
    aggregateType: "startup_complete_product",
    aggregateId: input.domain,
    payload: {
      ...payload,
      hash: sha256(JSON.stringify(payload))
    },
    createdAt: input.generatedAt
  };
}

export function completeProductStatus(
  criteria: StartupCompleteProductCriterion[]
): StartupCompleteProductStatus {
  return criteria.every((criterion) => criterion.status === "passed")
    ? "complete"
    : "incomplete";
}

export function completeProductScore(
  criteria: StartupCompleteProductCriterion[]
): number {
  if (criteria.length === 0) {
    return 0;
  }

  return (
    Math.round(
      (criteria.filter((criterion) => criterion.status === "passed").length /
        criteria.length) *
        100
    ) / 100
  );
}

function listOrNone<T>(items: T[], formatter: (item: T) => string): string {
  if (items.length === 0) {
    return "- none";
  }

  return items.map(formatter).join("\n");
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}
