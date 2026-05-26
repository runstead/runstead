import {
  hasNonEmptyString,
  isRecord,
  parsedArtifactContent,
  type StartupGateEvidenceArtifact
} from "./startup-gate-artifacts.js";
import type { StartupGateEvidenceRow } from "./startup-gate-evaluation.js";

export function uiValidationBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  return latestUiValidationsByTarget(evidence, artifacts)
    .filter((item) => uiValidationFailed(artifacts.get(item.id)))
    .map((item) => `frontend UI validation failed: ${item.summary ?? item.id}`);
}

function latestUiValidationsByTarget(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): StartupGateEvidenceRow[] {
  const latestByTarget = new Map<string, StartupGateEvidenceRow>();

  for (const item of evidence.filter((row) => row.type === "startup_ui_validation")) {
    const target = uiValidationTarget(item, artifacts.get(item.id));
    const current = latestByTarget.get(target);

    if (current === undefined || evidenceIsNewer(item, current)) {
      latestByTarget.set(target, item);
    }
  }

  return [...latestByTarget.values()];
}

function uiValidationTarget(
  row: StartupGateEvidenceRow,
  artifact: StartupGateEvidenceArtifact | undefined
): string {
  const content = parsedArtifactContent(artifact);

  if (
    isRecord(content) &&
    hasNonEmptyString(content.url) &&
    hasNonEmptyString(content.viewport)
  ) {
    return `${content.url} ${content.viewport}`;
  }

  return row.summary ?? row.id;
}

function evidenceIsNewer(
  candidate: StartupGateEvidenceRow,
  current: StartupGateEvidenceRow
): boolean {
  const candidateTime = Date.parse(candidate.created_at);
  const currentTime = Date.parse(current.created_at);

  if (Number.isFinite(candidateTime) && Number.isFinite(currentTime)) {
    return candidateTime === currentTime
      ? candidate.id > current.id
      : candidateTime > currentTime;
  }

  return candidate.created_at === current.created_at
    ? candidate.id > current.id
    : candidate.created_at > current.created_at;
}

function uiValidationFailed(
  artifact: StartupGateEvidenceArtifact | undefined
): boolean {
  const content = parsedArtifactContent(artifact);

  return (
    isRecord(content) &&
    [
      content.domStatus,
      content.accessibilityStatus,
      content.responsiveStatus,
      content.criticalFlowStatus
    ].some((status) => status === "fail" || status === "failed")
  );
}
