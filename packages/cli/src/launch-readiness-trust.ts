import type { JsonObject } from "@runstead/core";

import type {
  LaunchReadinessReportData,
  PreviousLaunchReadinessReport
} from "./launch-readiness-data.js";
import {
  artifactSources,
  currentEvidenceRows,
  parsedEvidenceContent,
  readEvidenceProvenanceArtifact,
  staleEvidenceRows
} from "./launch-readiness-evidence.js";

export type LaunchReadinessStatus = "launch_ready" | "blocked";

export interface LaunchReadinessTrustSummary {
  qualityScore: number;
  evidenceCompletenessScore: number;
  conclusion: string;
  remediationEffort: string;
  acceptedDebtRegister: string[];
  trend: {
    previousStatus?: string;
    previousBlockers?: number;
    blockerDelta: number;
    addedBlockers: string[];
    resolvedBlockers: string[];
  };
  auditExport: {
    schemaVersion: 1;
    evidenceRecords: number;
    staleEvidenceRecords: number;
    structuredArtifacts: number;
  };
}

export function launchReadinessTrustSummary(input: {
  status: LaunchReadinessStatus;
  blockers: string[];
  data: LaunchReadinessReportData;
  previousReport?: PreviousLaunchReadinessReport;
}): LaunchReadinessTrustSummary {
  const requiredEvidenceTypes = [
    "command_output",
    "startup_measurement_framework",
    "startup_metric_snapshot",
    "startup_repo_readiness",
    "startup_security_baseline",
    "startup_migration_plan",
    "startup_rollback_plan",
    "startup_observability",
    "startup_founder_bottleneck"
  ];
  const currentEvidence = currentEvidenceRows(input.data);
  const completedEvidence = requiredEvidenceTypes.filter((type) =>
    currentEvidence.some((item) => item.type === type)
  );
  const evidenceCompletenessScore =
    completedEvidence.length / requiredEvidenceTypes.length;
  const hasProvenance = currentEvidence.some(
    (item) => artifactSources(readEvidenceProvenanceArtifact(item.uri)).length > 0
  );
  const qualityScore = clampScore(
    evidenceCompletenessScore * 0.7 +
      (input.data.structuredArtifacts.length > 0 ? 0.1 : 0) +
      (hasProvenance ? 0.1 : 0) +
      (input.status === "launch_ready" ? 0.1 : 0) -
      Math.min(input.blockers.length * 0.06, 0.5)
  );
  const previousBlockers = input.previousReport?.blockers ?? [];
  const currentBlockers = input.blockers;
  const acceptedDebtRegister = acceptedDebtRegisterRows(input.data);

  return {
    qualityScore,
    evidenceCompletenessScore,
    conclusion:
      input.status === "launch_ready"
        ? "Launch-ready: required gate, verifier, readiness, security, and operational evidence are present."
        : `Not launch-ready: ${input.blockers.length} blocker${input.blockers.length === 1 ? "" : "s"} remain; top blocker is ${input.blockers[0] ?? "unknown"}.`,
    remediationEffort: remediationEffort(input.blockers),
    acceptedDebtRegister,
    trend: {
      ...(input.previousReport?.status === undefined
        ? {}
        : { previousStatus: input.previousReport.status }),
      ...(input.previousReport === undefined
        ? {}
        : { previousBlockers: previousBlockers.length }),
      blockerDelta: currentBlockers.length - previousBlockers.length,
      addedBlockers: currentBlockers.filter(
        (blocker) => !previousBlockers.includes(blocker)
      ),
      resolvedBlockers: previousBlockers.filter(
        (blocker) => !currentBlockers.includes(blocker)
      )
    },
    auditExport: {
      schemaVersion: 1,
      evidenceRecords: currentEvidence.length,
      staleEvidenceRecords: staleEvidenceRows(input.data).length,
      structuredArtifacts: input.data.structuredArtifacts.length
    }
  };
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatScore(value: number): string {
  return String(clampScore(value));
}

function acceptedDebtRegisterRows(data: LaunchReadinessReportData): string[] {
  const debtEvidence = currentEvidenceRows(data).filter(
    (item) =>
      item.type === "startup_acceptable_debt" || item.type === "startup_decision"
  );
  const rows = debtEvidence.flatMap((item) => {
    const content = parsedEvidenceContent(item.uri);

    if (!isRecord(content)) {
      return item.type === "startup_acceptable_debt"
        ? [`${item.id}: ${item.summary ?? "accepted debt"} owner=unknown`]
        : [];
    }

    if (
      item.type !== "startup_acceptable_debt" &&
      content.decision !== "launch_with_accepted_debt"
    ) {
      return [];
    }

    return [
      `${item.id}: ${stringValue(content.reason) ?? item.summary ?? "accepted debt"} owner=${stringValue(content.owner) ?? "unknown"} expires=${stringValue(content.expiresAt) ?? "none"}`
    ];
  });

  return rows.length === 0 ? ["none recorded"] : rows;
}

function remediationEffort(blockers: string[]): string {
  if (blockers.length === 0) {
    return "low: keep gates green and rerun before release";
  }

  if (blockers.length <= 2) {
    return "medium: one focused remediation loop should be enough";
  }

  if (blockers.length <= 5) {
    return "high: split remediation into verifier, evidence, and governance tracks";
  }

  return "very high: defer launch and run a full remediation plan";
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
