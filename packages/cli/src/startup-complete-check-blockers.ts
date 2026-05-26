import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { LaunchReadinessReportResult } from "./launch-readiness-report.js";
import type { StartupCompleteProductBlockerAudit } from "./startup-complete-check.js";
import type { StartupGateCheckResult } from "./startup-evidence.js";

export interface StartupCompleteProductEvidenceRow {
  id: string;
  type: string;
  uri: string;
  summary: string | null;
  created_at: string;
}

interface StartupEvidenceArtifact {
  associations?: unknown;
  remediation?: unknown;
}

export function startupCompleteProductBlockers(input: {
  gate: StartupGateCheckResult;
  launchReport: LaunchReadinessReportResult;
  evidenceRows: StartupCompleteProductEvidenceRow[];
}): StartupCompleteProductBlockerAudit[] {
  return input.launchReport.blockers.map((blocker) => {
    const finding = input.gate.findings.find((item) => item.message === blocker);
    const matchingEvidence = input.evidenceRows.filter((row) =>
      evidenceMatchesBlocker(row, blocker)
    );
    const owner =
      matchingEvidence
        .map((row) => artifactRemediationOwner(readEvidenceArtifact(row.uri)))
        .find((value): value is string => value !== undefined) ?? "founder";

    return {
      blocker,
      severity: finding?.severity ?? "major",
      owner,
      remediationTask:
        finding?.remediationTask ?? "startup gate no longer reports this blocker",
      evidenceSources: uniqueNonEmpty([
        input.gate.event.eventId,
        input.launchReport.reportPath,
        input.launchReport.jsonPath,
        ...matchingEvidence.map((row) => row.id)
      ])
    };
  });
}

function evidenceMatchesBlocker(
  row: StartupCompleteProductEvidenceRow,
  blocker: string
): boolean {
  const artifact = readEvidenceArtifact(row.uri);
  const summary = row.summary ?? "";

  if (summary.includes(blocker)) {
    return true;
  }

  if (isRecord(artifact?.associations) && artifact.associations.blocker === blocker) {
    return true;
  }

  return false;
}

function artifactRemediationOwner(
  artifact: StartupEvidenceArtifact | undefined
): string | undefined {
  if (!isRecord(artifact?.remediation)) {
    return undefined;
  }

  return typeof artifact.remediation.owner === "string" &&
    artifact.remediation.owner.trim().length > 0
    ? artifact.remediation.owner
    : undefined;
}

function readEvidenceArtifact(uri: string): StartupEvidenceArtifact | undefined {
  try {
    const parsed = JSON.parse(readFileSync(fileURLToPath(uri), "utf8")) as unknown;

    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
