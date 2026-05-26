export interface StartupReadinessEvidenceCurrentKeyRow {
  type: string;
  uri: string;
}

export function startupReadinessEvidenceIsStale(
  artifact: unknown,
  checkedAt: string,
  currentCodeFingerprint?: string
): boolean {
  return (
    startupReadinessEvidenceCodeFingerprintStale(artifact, currentCodeFingerprint) ||
    startupReadinessArtifactSources(artifact).some((source) => {
      if (
        typeof source.uri !== "string" ||
        typeof source.capturedAt !== "string" ||
        typeof source.freshnessDays !== "number"
      ) {
        return false;
      }

      const capturedAt = Date.parse(source.capturedAt);
      const checkedAtMs = Date.parse(checkedAt);

      if (Number.isNaN(capturedAt) || Number.isNaN(checkedAtMs)) {
        return false;
      }

      const ageDays = Math.floor((checkedAtMs - capturedAt) / 86_400_000);

      return ageDays > source.freshnessDays;
    })
  );
}

export function startupReadinessEvidenceCodeFingerprintStale(
  artifact: unknown,
  currentCodeFingerprint: string | undefined
): boolean {
  if (currentCodeFingerprint === undefined || !isRecord(artifact)) {
    return false;
  }

  const codeState = artifact.codeState;

  if (!isRecord(codeState) || typeof codeState.fingerprint !== "string") {
    return false;
  }

  return codeState.fingerprint !== currentCodeFingerprint;
}

export function startupReadinessEvidenceCurrentKey(
  row: StartupReadinessEvidenceCurrentKeyRow,
  artifact: unknown
): string {
  const content = parsedStartupReadinessArtifactContent(artifact);

  if (row.type === "startup_ui_validation") {
    const url = isRecord(content) ? stringValue(content.url) : undefined;
    const viewport = isRecord(content) ? stringValue(content.viewport) : undefined;

    return `${row.type}:${url ?? row.uri}:${viewport ?? "unknown"}`;
  }

  if (row.type === "startup_metric" || row.type === "startup_metric_snapshot") {
    const metric = isRecord(content) ? stringValue(content.metric) : undefined;

    return `${row.type}:${metric ?? row.uri}`;
  }

  return row.type;
}

export function parsedStartupReadinessArtifactContent(artifact: unknown): unknown {
  if (!isRecord(artifact)) {
    return undefined;
  }

  if (typeof artifact.content !== "string") {
    return artifact;
  }

  try {
    return JSON.parse(artifact.content) as unknown;
  } catch {
    return artifact.content;
  }
}

export function startupReadinessArtifactSources(
  artifact: unknown
): Record<string, unknown>[] {
  if (!isRecord(artifact) || !Array.isArray(artifact.sources)) {
    return [];
  }

  return artifact.sources.filter(isRecord);
}

export function stagingDeploymentText(text: string): boolean {
  return text.includes("staging") && text.includes("deployment");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
