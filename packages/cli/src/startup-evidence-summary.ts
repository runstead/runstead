import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { StartupArtifactListItem } from "./startup-artifacts.js";

export interface StartupEvidenceSummaryRow {
  id: string;
  type: string;
  summary: string | null;
  created_at: string;
}

export function formatEvidenceSummary(evidence: StartupEvidenceSummaryRow[]): string {
  return evidence.length === 0
    ? "- none"
    : evidence
        .map((item) => `- ${item.id}: ${item.type}: ${item.summary ?? "no summary"}`)
        .join("\n");
}

export function formatCategoryCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  return entries.length === 0
    ? "- none"
    : entries.map(([category, count]) => `- ${category}: ${count}`).join("\n");
}

export function supportCategoryCountsFromArtifacts(
  artifacts: StartupArtifactListItem[]
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const item of artifacts) {
    if (item.kind !== "startup_support_triage") {
      continue;
    }

    const category =
      typeof item.artifact.data.category === "string"
        ? item.artifact.data.category
        : "uncategorized";

    counts[category] = (counts[category] ?? 0) + 1;
  }

  return counts;
}

export function readStartupEvidenceSummaries(
  database: RunsteadDatabase
): StartupEvidenceSummaryRow[] {
  return database
    .prepare(
      `
      SELECT id, type, summary, created_at
      FROM evidence
      WHERE type LIKE 'startup_%'
      ORDER BY created_at DESC, id ASC
      LIMIT 50
    `
    )
    .all() as unknown as StartupEvidenceSummaryRow[];
}
