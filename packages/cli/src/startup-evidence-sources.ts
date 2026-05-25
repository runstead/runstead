import type { JsonObject } from "@runstead/core";

export interface StartupEvidenceSourceInput {
  kind?: string;
  uri: string;
  capturedAt?: string;
  freshnessDays?: number;
  hash?: string;
  trustLevel?: string;
  provenance?: JsonObject;
}

export interface StartupEvidenceSource {
  kind: string;
  uri: string;
  capturedAt: string;
  freshnessDays?: number;
  hash?: string;
  trustLevel?: string;
  provenance?: JsonObject;
}

export function normalizeStartupEvidenceSources(input: {
  createdAt: string;
  sourceRefs: string[];
  sources: StartupEvidenceSourceInput[];
}): StartupEvidenceSource[] {
  const explicitSources = input.sources.map((source) =>
    normalizeStartupEvidenceSource(source, input.createdAt)
  );
  const explicitUris = new Set(explicitSources.map((source) => source.uri));
  const inferredSources = input.sourceRefs
    .filter((sourceRef) => sourceRef.trim().length > 0)
    .filter((sourceRef) => !explicitUris.has(sourceRef))
    .map((sourceRef) =>
      normalizeStartupEvidenceSource(
        {
          uri: sourceRef,
          kind: inferStartupEvidenceSourceKind(sourceRef)
        },
        input.createdAt
      )
    );

  return [...explicitSources, ...inferredSources];
}

export function startupEvidenceProvenance(input: {
  createdAt: string;
  sources: StartupEvidenceSource[];
}): JsonObject {
  return {
    recordedBy: "runstead",
    recordedAt: input.createdAt,
    sourceCount: input.sources.length,
    sourceKinds: [...new Set(input.sources.map((source) => source.kind))],
    captureMode:
      input.sources.length === 0 ||
      input.sources.every((source) => source.kind === "manual")
        ? "manual_seed"
        : "source_attached"
  };
}

function normalizeStartupEvidenceSource(
  source: StartupEvidenceSourceInput,
  fallbackCapturedAt: string
): StartupEvidenceSource {
  const uri = source.uri.trim();

  if (uri.length === 0) {
    throw new Error("startup evidence source uri cannot be empty");
  }

  const capturedAt = source.capturedAt ?? fallbackCapturedAt;

  if (Number.isNaN(Date.parse(capturedAt))) {
    throw new Error(`startup evidence source capturedAt is invalid: ${capturedAt}`);
  }

  if (
    source.freshnessDays !== undefined &&
    (!Number.isInteger(source.freshnessDays) || source.freshnessDays <= 0)
  ) {
    throw new Error("startup evidence source freshnessDays must be positive");
  }

  const kind = (source.kind ?? inferStartupEvidenceSourceKind(uri)).trim();

  if (kind.length === 0) {
    throw new Error("startup evidence source kind cannot be empty");
  }

  return {
    kind,
    uri,
    capturedAt,
    ...(source.freshnessDays === undefined
      ? {}
      : { freshnessDays: source.freshnessDays }),
    ...(source.hash === undefined ? {} : { hash: source.hash }),
    ...(source.trustLevel === undefined
      ? {}
      : { trustLevel: normalizeTrustLevel(source.trustLevel) }),
    ...(source.provenance === undefined ? {} : { provenance: source.provenance })
  };
}

function normalizeTrustLevel(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "authoritative"
  ) {
    return normalized;
  }

  throw new Error(
    "startup evidence source trustLevel must be one of: low, medium, high, authoritative"
  );
}

function inferStartupEvidenceSourceKind(uri: string): string {
  const lowered = uri.toLowerCase();

  if (lowered.startsWith("github:") || lowered.includes("github.com")) {
    return "github";
  }

  if (lowered.startsWith("jira:") || lowered.includes("atlassian.net")) {
    return "jira";
  }

  if (lowered.startsWith("linear:")) {
    return "linear";
  }

  if (lowered.startsWith("posthog:") || lowered.includes("posthog")) {
    return "posthog";
  }

  if (lowered.startsWith("amplitude:") || lowered.includes("amplitude")) {
    return "amplitude";
  }

  if (
    lowered.startsWith("sql:") ||
    lowered.startsWith("db:") ||
    lowered.startsWith("postgres:")
  ) {
    return "db_query";
  }

  if (lowered.startsWith("csv:") || lowered.endsWith(".csv")) {
    return "csv";
  }

  if (
    lowered.startsWith("pr:") ||
    lowered.startsWith("pull-request:") ||
    lowered.includes("/pull/")
  ) {
    return "pull_request";
  }

  if (
    lowered.startsWith("support:") ||
    lowered.startsWith("zendesk:") ||
    lowered.startsWith("intercom:")
  ) {
    return "support_ticket";
  }

  if (lowered.startsWith("browser:") || lowered.startsWith("screenshot:")) {
    return "browser_ui";
  }

  if (lowered.startsWith("deploy:") || lowered.startsWith("deployment:")) {
    return "deployment";
  }

  if (lowered.startsWith("file:") || uri.startsWith("/") || uri.startsWith(".")) {
    return "file";
  }

  if (lowered.startsWith("http://") || lowered.startsWith("https://")) {
    return "url";
  }

  return "manual";
}
