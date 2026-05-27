import {
  hasHypothesisAssociation,
  hasNonEmptyString,
  hasNonEmptyValue,
  hasSourceRefs,
  isRecord,
  parsedArtifactContent,
  type StartupGateEvidenceArtifact
} from "./startup-gate-artifacts.js";
import {
  parseStartupHypothesisStatusValue,
  type StartupHypothesisKind,
  type StartupHypothesisStatus
} from "./startup-evidence-types.js";
import type { StartupGateEvidenceRow } from "./startup-gate-types.js";

export function validationBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  return [
    ...hypothesisGateBlockers("problem", evidence, artifacts),
    ...hypothesisGateBlockers("user", evidence, artifacts),
    ...hypothesisGateBlockers("solution", evidence, artifacts),
    ...(hasValidationEvidence(evidence, artifacts)
      ? []
      : ["customer, competitor, or metric validation evidence is missing"]),
    ...(hasEvidenceType(evidence, "startup_disconfirming")
      ? []
      : ["disconfirming evidence is missing"]),
    ...disconfirmingEvidenceBlockers(evidence, artifacts)
  ];
}

export function hasStructuredMetricEvidence(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): boolean {
  return evidence
    .filter(
      (item) =>
        item.type === "startup_metric" || item.type === "startup_metric_snapshot"
    )
    .some((item) => {
      const content = parsedArtifactContent(artifacts.get(item.id));

      return (
        isRecord(content) &&
        hasNonEmptyString(content.source) &&
        hasNonEmptyValue(content.threshold) &&
        hasNonEmptyValue(content.current)
      );
    });
}

function hypothesisGateBlockers(
  kind: StartupHypothesisKind,
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  const rows = evidence.filter((item) => item.type === `startup_${kind}_hypothesis`);

  if (rows.length === 0) {
    return [`${kind} hypothesis is missing`];
  }

  const latestStatus = hypothesisStatus(artifacts.get(rows[0]?.id ?? ""));

  if (latestStatus === "validated") {
    return [];
  }

  if (latestStatus === "invalidated") {
    return [`${kind} hypothesis is invalidated`];
  }

  if (latestStatus === "needs-more-evidence") {
    return [`${kind} hypothesis needs more evidence`];
  }

  return [`${kind} hypothesis is open and not validated`];
}

function hypothesisStatus(
  artifact: StartupGateEvidenceArtifact | undefined
): StartupHypothesisStatus {
  const content = parsedArtifactContent(artifact);

  if (!isRecord(content)) {
    return "open";
  }

  return parseStartupHypothesisStatusValue(content.status);
}

function disconfirmingEvidenceBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  return evidence
    .filter((item) => item.type === "startup_disconfirming")
    .filter((item) => disconfirmingEvidenceBlocksMvp(artifacts.get(item.id)))
    .map((item) => {
      const summary = item.summary ?? "disconfirming evidence";

      return `disconfirming evidence blocks MVP build: ${summary}`;
    });
}

function disconfirmingEvidenceBlocksMvp(
  artifact: StartupGateEvidenceArtifact | undefined
): boolean {
  const content = parsedArtifactContent(artifact);

  if (!isRecord(content)) {
    return false;
  }

  return content.impact === "blocker" || content.impact === "invalidates";
}

function hasValidationEvidence(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): boolean {
  if (hasStructuredMetricEvidence(evidence, artifacts)) {
    return true;
  }

  return ["startup_customer_interview", "startup_competitor", "startup_metric"].some(
    (type) =>
      evidence
        .filter((item) => item.type === type)
        .some((item) => hasStructuredValidationArtifact(item, artifacts.get(item.id)))
  );
}

function hasStructuredValidationArtifact(
  row: StartupGateEvidenceRow,
  artifact: StartupGateEvidenceArtifact | undefined
): boolean {
  if (row.type === "startup_metric") {
    const content = parsedArtifactContent(artifact);

    return (
      isRecord(content) &&
      hasNonEmptyString(content.source) &&
      hasNonEmptyValue(content.threshold) &&
      hasNonEmptyValue(content.current)
    );
  }

  if (row.type === "startup_customer_interview") {
    const content = parsedArtifactContent(artifact);

    return (
      isRecord(content) &&
      hasSourceRefs(artifact) &&
      hasHypothesisAssociation(artifact) &&
      hasNonEmptyString(content.persona) &&
      hasNonEmptyString(content.problem) &&
      hasNonEmptyString(content.signalStrength) &&
      (hasNonEmptyString(content.quote) || hasNonEmptyString(content.summary))
    );
  }

  if (row.type === "startup_competitor") {
    const content = parsedArtifactContent(artifact);

    return (
      isRecord(content) &&
      hasSourceRefs(artifact) &&
      hasNonEmptyString(content.competitor) &&
      hasNonEmptyString(content.finding) &&
      hasNonEmptyString(content.signalStrength)
    );
  }

  return false;
}

function hasEvidenceType(evidence: StartupGateEvidenceRow[], type: string): boolean {
  return evidence.some((item) => item.type === type);
}
