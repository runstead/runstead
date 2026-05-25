export interface StartupGateEvidenceArtifact {
  sourceRefs?: unknown;
  sources?: unknown;
  associations?: unknown;
  remediation?: unknown;
  content?: unknown;
  result?: unknown;
}

export function parsedArtifactContent(
  artifact: StartupGateEvidenceArtifact | undefined
): unknown {
  if (artifact === undefined || typeof artifact.content !== "string") {
    return undefined;
  }

  try {
    return JSON.parse(artifact.content) as unknown;
  } catch {
    return undefined;
  }
}

export function artifactSources(artifact: StartupGateEvidenceArtifact | undefined): {
  uri?: unknown;
  capturedAt?: unknown;
  freshnessDays?: unknown;
}[] {
  return Array.isArray(artifact?.sources)
    ? artifact.sources.filter(isRecord).map((source) => ({
        uri: source.uri,
        capturedAt: source.capturedAt,
        freshnessDays: source.freshnessDays
      }))
    : [];
}

export function hasSourceRefs(
  artifact: StartupGateEvidenceArtifact | undefined
): boolean {
  return (
    artifact !== undefined &&
    Array.isArray(artifact.sourceRefs) &&
    artifact.sourceRefs.some((sourceRef) => hasNonEmptyString(sourceRef))
  );
}

export function hasHypothesisAssociation(
  artifact: StartupGateEvidenceArtifact | undefined
): boolean {
  return (
    isRecord(artifact?.associations) &&
    hasNonEmptyString(artifact.associations.hypothesisId)
  );
}

export function hasDecisionAssociation(
  artifact: StartupGateEvidenceArtifact | undefined
): boolean {
  return (
    isRecord(artifact?.associations) &&
    hasNonEmptyString(artifact.associations.decisionId)
  );
}

export function hasNonEmptyValue(value: unknown): boolean {
  return (
    hasNonEmptyString(value) ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
}

export function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function arrayHasString(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => hasNonEmptyString(item));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
