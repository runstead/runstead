import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

import type {
  StartupStatusEvidenceSummary,
  StartupStatusStaleSource
} from "./startup-status-types.js";

interface EvidenceRow {
  id: string;
  type: string;
  uri: string;
  summary: string | null;
  created_at: string;
}

interface StartupEvidenceArtifact {
  sources?: unknown;
}

interface StartupEvidenceSource {
  kind?: unknown;
  uri?: unknown;
  capturedAt?: unknown;
  freshnessDays?: unknown;
}

export function readStartupStatusEvidence(input: {
  stateDb: string;
  generatedAt: string;
}): StartupStatusEvidenceSummary {
  const database = openRunsteadDatabase(input.stateDb);

  try {
    const rows = database
      .prepare(
        `
        SELECT id, type, uri, summary, created_at
        FROM evidence
        WHERE type = 'command_output' OR type LIKE 'startup_%'
        ORDER BY created_at DESC, id DESC
      `
      )
      .all() as unknown as EvidenceRow[];
    const sourceKinds = new Set<string>();
    const staleSources: StartupStatusStaleSource[] = [];

    for (const row of rows) {
      const artifact = readEvidenceArtifact(row.uri);

      for (const source of artifactSources(artifact)) {
        if (typeof source.kind === "string" && source.kind.trim().length > 0) {
          sourceKinds.add(source.kind);
        }

        const stale = staleSource(row, source, input.generatedAt);

        if (stale !== undefined) {
          staleSources.push(stale);
        }
      }
    }

    const latest = rows[0];

    return {
      total: rows.length,
      ...(latest === undefined
        ? {}
        : {
            latest: {
              id: latest.id,
              type: latest.type,
              ...(latest.summary === null ? {} : { summary: latest.summary }),
              createdAt: latest.created_at
            }
          }),
      staleSources,
      sourceKinds: [...sourceKinds].sort()
    };
  } finally {
    database.close();
  }
}

function readEvidenceArtifact(uri: string): StartupEvidenceArtifact | undefined {
  try {
    const parsed = JSON.parse(readFileSync(fileURLToPath(uri), "utf8")) as unknown;

    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function artifactSources(
  artifact: StartupEvidenceArtifact | undefined
): StartupEvidenceSource[] {
  return Array.isArray(artifact?.sources) ? artifact.sources.filter(isRecord) : [];
}

function staleSource(
  row: EvidenceRow,
  source: StartupEvidenceSource,
  generatedAt: string
): StartupStatusStaleSource | undefined {
  if (
    typeof source.uri !== "string" ||
    typeof source.capturedAt !== "string" ||
    typeof source.freshnessDays !== "number"
  ) {
    return undefined;
  }

  const capturedAt = Date.parse(source.capturedAt);
  const checkedAt = Date.parse(generatedAt);

  if (Number.isNaN(capturedAt) || Number.isNaN(checkedAt)) {
    return undefined;
  }

  const ageDays = Math.floor((checkedAt - capturedAt) / 86_400_000);

  return ageDays > source.freshnessDays
    ? {
        evidenceId: row.id,
        type: row.type,
        uri: source.uri,
        capturedAt: source.capturedAt,
        freshnessDays: source.freshnessDays,
        ageDays
      }
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
