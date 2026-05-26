import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { JsonObject } from "@runstead/core";

import type { EvidenceProvenanceArtifact } from "./launch-readiness-data.js";

export function parsedEvidenceContent(uri: string): unknown {
  const artifact = readEvidenceProvenanceArtifact(uri);

  if (!isEvidenceRecord(artifact) || typeof artifact.content !== "string") {
    return undefined;
  }

  try {
    return JSON.parse(artifact.content) as unknown;
  } catch {
    return undefined;
  }
}

export function readEvidenceProvenanceArtifact(
  uri: string
): EvidenceProvenanceArtifact | undefined {
  try {
    const parsed = JSON.parse(readFileSync(fileURLToPath(uri), "utf8")) as unknown;

    return isEvidenceRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function artifactSources(
  artifact: EvidenceProvenanceArtifact | undefined
): JsonObject[] {
  if (artifact === undefined || !Array.isArray(artifact.sources)) {
    return [];
  }

  return artifact.sources.filter((source): source is JsonObject =>
    isEvidenceRecord(source)
  );
}

export function formatArtifactSource(source: JsonObject): string {
  const kind = stringValue(source.kind) ?? "unknown";
  const uri = stringValue(source.uri) ?? "missing";
  const capturedAt = stringValue(source.capturedAt) ?? "unknown";
  const freshness =
    typeof source.freshnessDays === "number"
      ? ` freshness=${source.freshnessDays}d`
      : "";
  const hash = stringValue(source.hash);

  return `source=${kind} uri=${uri} captured=${capturedAt}${freshness}${hash === undefined ? "" : ` hash=${hash}`}`;
}

export function isEvidenceRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
