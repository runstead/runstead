import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import type { JsonObject } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type {
  LaunchReadinessReportData,
  PreviousLaunchReadinessReport
} from "./launch-readiness-data.js";
import { currentEvidenceRows, staleEvidenceRows } from "./launch-readiness-evidence.js";
import type {
  LaunchReadinessTarget,
  LaunchReadinessTargetStatus
} from "./launch-readiness-types.js";
import type {
  LaunchReadinessStatus,
  LaunchReadinessTrustSummary
} from "./launch-readiness-trust.js";

export function readPreviousLaunchReadinessEvent(
  database: RunsteadDatabase,
  aggregateId: string
): PreviousLaunchReadinessReport | undefined {
  const row = database
    .prepare(
      `
      SELECT event_id, payload_json
      FROM events
      WHERE type = 'report.generated'
        AND aggregate_id = ?
      ORDER BY created_at DESC, event_id DESC
      LIMIT 1
    `
    )
    .get(aggregateId) as { event_id: string; payload_json: string } | undefined;

  if (row === undefined) {
    return undefined;
  }

  try {
    const payload = JSON.parse(row.payload_json) as unknown;

    if (!isRecord(payload)) {
      return {
        eventId: row.event_id,
        blockers: []
      };
    }

    return {
      eventId: row.event_id,
      ...(typeof payload.status === "string" ? { status: payload.status } : {}),
      blockers: Array.isArray(payload.blockers)
        ? payload.blockers.filter((item): item is string => typeof item === "string")
        : []
    };
  } catch {
    return {
      eventId: row.event_id,
      blockers: []
    };
  }
}

export function launchReadinessReportEventPayload(input: {
  domain: string;
  status: LaunchReadinessStatus;
  target: LaunchReadinessTarget;
  targetStatus: LaunchReadinessTargetStatus;
  blockers: string[];
  reportPath: string;
  jsonPath: string;
  markdown: string;
  trustSummary: LaunchReadinessTrustSummary;
  data: LaunchReadinessReportData;
}): JsonObject {
  return {
    reportType: "launch_readiness",
    domain: input.domain,
    target: input.target,
    status: input.status,
    targetStatus: input.targetStatus,
    blockers: input.blockers,
    uri: pathToFileURL(input.reportPath).href,
    jsonUri: pathToFileURL(input.jsonPath).href,
    hash: sha256(input.markdown),
    trustSummary: input.trustSummary,
    summary: {
      blockers: input.blockers.length,
      goals: input.data.goals.length,
      tasks: input.data.tasks.length,
      evidence: currentEvidenceRows(input.data).length,
      staleEvidence: staleEvidenceRows(input.data).length,
      structuredArtifacts: input.data.structuredArtifacts.length,
      protectedPathChanges: input.data.protectedPathChanges.length
    }
  };
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
