import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

interface EvidenceSourceRefRow {
  id: string;
  uri: string;
}

interface StartupEvidenceArtifactFile {
  sourceRefs?: unknown;
}

export function startupEvidenceSourceRefIndex(stateDb: string): Map<string, string[]> {
  const database = openRunsteadDatabase(stateDb);

  try {
    const rows = database
      .prepare(
        `
        SELECT id, uri
        FROM evidence
        WHERE type LIKE 'startup_%'
        ORDER BY created_at DESC, id ASC
      `
      )
      .all() as unknown as EvidenceSourceRefRow[];
    const index = new Map<string, string[]>();

    for (const row of rows) {
      for (const sourceRef of startupEvidenceSourceRefs(row.uri)) {
        const current = index.get(sourceRef) ?? [];

        current.push(row.id);
        index.set(sourceRef, current);
      }
    }

    return index;
  } finally {
    database.close();
  }
}

function startupEvidenceSourceRefs(uri: string): string[] {
  try {
    const parsed = JSON.parse(
      readFileSync(fileURLToPath(uri), "utf8")
    ) as StartupEvidenceArtifactFile;

    return Array.isArray(parsed.sourceRefs)
      ? parsed.sourceRefs.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}
