import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

import {
  inferStartupMetricSourceClass,
  parseStartupMetricSourceClass,
  startupMetricConfidenceProfile
} from "./startup-metric-confidence.js";
import type {
  MetricSnapshotArtifact,
  MetricSnapshotRow,
  ParsedMetricSnapshot
} from "./startup-metrics-types.js";

export function readMetricSnapshots(
  stateDb: string,
  now: Date
): ParsedMetricSnapshot[] {
  const database = openRunsteadDatabase(stateDb);

  try {
    const rows = database
      .prepare(
        `
        SELECT id, uri, created_at
        FROM evidence
        WHERE type = 'startup_metric_snapshot'
        ORDER BY created_at DESC, id DESC
      `
      )
      .all() as unknown as MetricSnapshotRow[];

    return rows.flatMap((row) => {
      const artifact = readMetricSnapshotArtifact(row.uri);
      const content = parsedArtifactContent(artifact);

      if (
        !isRecord(content) ||
        typeof content.metric !== "string" ||
        typeof content.source !== "string"
      ) {
        return [];
      }

      return [
        (() => {
          const sourceClass =
            typeof content.sourceClass === "string"
              ? parseStartupMetricSourceClass(content.sourceClass)
              : inferStartupMetricSourceClass({
                  source: content.source,
                  sourceRefs: [],
                  sources: artifactSources(artifact)
                });
          const profile = startupMetricConfidenceProfile(
            sourceClass,
            metricNumber(content.confidence)
          );

          return {
            evidenceId: row.id,
            metric: content.metric,
            source: content.source,
            current: metricValue(content.current),
            threshold: metricValue(content.threshold),
            sourceClass: profile.sourceClass,
            confidence: profile.confidence,
            launchWeight: profile.launchWeight,
            realUserData: profile.realUserData,
            ...(typeof content.window === "string" ? { window: content.window } : {}),
            ...(typeof content.cohort === "string" ? { cohort: content.cohort } : {}),
            ...(typeof content.trend === "string" ? { trend: content.trend } : {}),
            stale: metricSnapshotStale(artifact, now),
            createdAt: row.created_at
          };
        })()
      ];
    });
  } finally {
    database.close();
  }
}

function readMetricSnapshotArtifact(uri: string): MetricSnapshotArtifact | undefined {
  try {
    const parsed = JSON.parse(readFileSync(fileURLToPath(uri), "utf8")) as unknown;

    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parsedArtifactContent(artifact: MetricSnapshotArtifact | undefined): unknown {
  if (typeof artifact?.content !== "string") {
    return undefined;
  }

  try {
    return JSON.parse(artifact.content) as unknown;
  } catch {
    return undefined;
  }
}

function metricSnapshotStale(
  artifact: MetricSnapshotArtifact | undefined,
  now: Date
): boolean {
  const sources = Array.isArray(artifact?.sources) ? artifact.sources : [];

  return sources.some((source) => {
    if (
      !isRecord(source) ||
      typeof source.capturedAt !== "string" ||
      typeof source.freshnessDays !== "number"
    ) {
      return false;
    }

    return (
      Math.floor((now.getTime() - Date.parse(source.capturedAt)) / 86_400_000) >
      source.freshnessDays
    );
  });
}

function artifactSources(
  artifact: MetricSnapshotArtifact | undefined
): { kind?: string; uri?: string }[] {
  return Array.isArray(artifact?.sources)
    ? artifact.sources.filter((source): source is { kind?: string; uri?: string } =>
        isRecord(source)
      )
    : [];
}

function metricNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function metricValue(value: unknown): string | number {
  return typeof value === "number" || typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
