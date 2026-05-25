import type { LaunchReadinessReportData } from "./launch-readiness-data.js";
import {
  currentEvidenceRows,
  staleEvidenceReason,
  staleEvidenceReasonGroups,
  staleEvidenceRows
} from "./launch-readiness-evidence.js";
import type {
  LaunchReadinessTarget,
  LaunchReadinessTargetStatus
} from "./launch-readiness-types.js";
import type {
  LaunchReadinessStatus,
  LaunchReadinessTrustSummary
} from "./launch-readiness-trust.js";

export function launchReadinessAuditExport(input: {
  generatedAt: string;
  domain: string;
  target: LaunchReadinessTarget;
  status: LaunchReadinessStatus;
  targetStatus: LaunchReadinessTargetStatus;
  blockers: string[];
  trustSummary: LaunchReadinessTrustSummary;
  data: LaunchReadinessReportData;
}) {
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    domain: input.domain,
    target: input.target,
    status: input.status,
    targetStatus: input.targetStatus,
    blockers: input.blockers,
    trustSummary: input.trustSummary,
    evidence: currentEvidenceRows(input.data).map((item) => ({
      id: item.id,
      type: item.type,
      summary: item.summary,
      uri: item.uri,
      createdAt: item.created_at
    })),
    staleEvidence: staleEvidenceRows(input.data).map((item) => ({
      id: item.id,
      type: item.type,
      summary: item.summary,
      uri: item.uri,
      createdAt: item.created_at,
      reason: staleEvidenceReason(input.data, item)
    })),
    staleEvidenceSummary: staleEvidenceReasonGroups(input.data).map((group) => ({
      reason: group.reason,
      count: group.count
    })),
    structuredArtifacts: input.data.structuredArtifacts.map((item) => ({
      id: item.id,
      kind: item.kind,
      path: item.path,
      sourceEvidenceIds: item.sourceEvidenceIds
    }))
  };
}
