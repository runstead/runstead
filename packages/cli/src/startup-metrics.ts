import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createRunsteadId, type Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { listGoals } from "./goals.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { addStartupEvidence } from "./startup-evidence.js";
import {
  inferStartupMetricSourceClass,
  parseStartupMetricSourceClass,
  resolveStartupMetricConfidenceProfile,
  startupMetricConfidenceProfile
} from "./startup-metric-confidence.js";
import type {
  AssessStartupMetricsOptions,
  AssessStartupMetricsResult,
  MetricSnapshotArtifact,
  MetricSnapshotRow,
  ParsedMetricSnapshot,
  RecordStartupMetricSnapshotOptions,
  RecordStartupMetricSnapshotResult,
  StartupMetricAssessment
} from "./startup-metrics-types.js";

export { STARTUP_METRIC_SOURCE_CLASSES } from "./startup-metric-confidence.js";
export type {
  StartupMetricConfidenceProfile,
  StartupMetricSourceClass
} from "./startup-metric-confidence.js";
export type {
  AssessStartupMetricsOptions,
  AssessStartupMetricsResult,
  RecordStartupMetricSnapshotOptions,
  RecordStartupMetricSnapshotResult,
  StartupMetricAssessment
} from "./startup-metrics-types.js";

export async function recordStartupMetricSnapshot(
  options: RecordStartupMetricSnapshotOptions
): Promise<RecordStartupMetricSnapshotResult> {
  const snapshotDate =
    options.snapshotDate ?? (options.now ?? new Date()).toISOString();
  const confidenceProfile = resolveStartupMetricConfidenceProfile(options);
  const content = {
    metric: options.metric,
    source: options.source,
    threshold: parseMetricValue(options.threshold),
    current: parseMetricValue(options.current),
    snapshotDate,
    sourceClass: confidenceProfile.sourceClass,
    confidence: confidenceProfile.confidence,
    launchWeight: confidenceProfile.launchWeight,
    realUserData: confidenceProfile.realUserData,
    ...(options.unit === undefined ? {} : { unit: options.unit }),
    ...(options.window === undefined ? {} : { window: options.window }),
    ...(options.cohort === undefined ? {} : { cohort: options.cohort }),
    ...(options.trend === undefined ? {} : { trend: options.trend }),
    ...(options.falsePositive === undefined
      ? {}
      : { falsePositive: options.falsePositive })
  };
  const sourceRefs =
    options.sourceRefs === undefined || options.sourceRefs.length === 0
      ? [options.source]
      : options.sourceRefs;
  const metricEvidence = await addStartupEvidence({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    type: "metric_snapshot",
    summary: `${options.metric} metric snapshot: current=${options.current}, threshold=${options.threshold}, source_class=${confidenceProfile.sourceClass}, confidence=${confidenceProfile.confidence}`,
    sourceRefs,
    ...(options.sources === undefined ? {} : { sources: options.sources }),
    content: JSON.stringify(content, null, 2),
    ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const falsePositiveEvidence =
    options.falsePositive === undefined
      ? undefined
      : await addStartupEvidence({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          type: "false_positive",
          summary: `False-positive control for ${options.metric}: ${options.falsePositive}`,
          sourceRefs,
          ...(options.sources === undefined ? {} : { sources: options.sources }),
          content: JSON.stringify(
            {
              metric: options.metric,
              source: options.source,
              snapshotEvidenceId: metricEvidence.evidence.id,
              sourceClass: confidenceProfile.sourceClass,
              confidence: confidenceProfile.confidence,
              falsePositive: options.falsePositive,
              snapshotDate
            },
            null,
            2
          ),
          ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
          ...(options.now === undefined ? {} : { now: options.now })
        });

  return {
    metricEvidence,
    confidenceProfile,
    ...(falsePositiveEvidence === undefined ? {} : { falsePositiveEvidence })
  };
}

export async function assessStartupMetrics(
  options: AssessStartupMetricsOptions = {}
): Promise<AssessStartupMetricsResult> {
  const cwd = options.cwd ?? process.cwd();
  const resolvedState = await requireRunsteadStateDb(cwd);
  const requiredMetrics = options.requiredMetrics ?? ["activation", "retention"];
  const snapshots = readMetricSnapshots(
    resolvedState.stateDb,
    options.now ?? new Date()
  );
  const metrics = requiredMetrics.map((metric) =>
    assessRequiredMetric(metric, snapshots)
  );
  const missingMetrics = metrics
    .filter((metric) => metric.status === "missing")
    .map((metric) => metric.metric);
  const belowThresholdMetrics = metrics
    .filter((metric) => metric.status === "below_threshold")
    .map((metric) => metric.metric);
  const staleMetrics = metrics
    .filter((metric) => metric.status === "stale")
    .map((metric) => metric.metric);
  const instrumentationTasks =
    options.createTasks === true && missingMetrics.length > 0
      ? createMetricInstrumentationTasks({
          cwd,
          stateDb: resolvedState.stateDb,
          metrics: missingMetrics,
          now: options.now ?? new Date()
        })
      : [];

  return {
    root: resolvedState.root,
    stateDb: resolvedState.stateDb,
    requiredMetrics,
    metrics,
    missingMetrics,
    belowThresholdMetrics,
    staleMetrics,
    instrumentationTasks
  };
}

function parseMetricValue(value: string): string | number {
  const numeric = Number(value);

  return value.trim() !== "" && Number.isFinite(numeric) ? numeric : value;
}

function readMetricSnapshots(stateDb: string, now: Date): ParsedMetricSnapshot[] {
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

function assessRequiredMetric(
  metric: string,
  snapshots: ParsedMetricSnapshot[]
): StartupMetricAssessment {
  const snapshot = snapshots.find((item) => item.metric === metric);

  if (snapshot === undefined) {
    return {
      metric,
      status: "missing"
    };
  }

  const belowThreshold =
    typeof snapshot.current === "number" &&
    typeof snapshot.threshold === "number" &&
    snapshot.current < snapshot.threshold;

  return {
    metric,
    status: snapshot.stale ? "stale" : belowThreshold ? "below_threshold" : "ok",
    current: snapshot.current,
    threshold: snapshot.threshold,
    sourceClass: snapshot.sourceClass,
    confidence: snapshot.confidence,
    launchWeight: snapshot.launchWeight,
    realUserData: snapshot.realUserData,
    ...(snapshot.window === undefined ? {} : { window: snapshot.window }),
    ...(snapshot.cohort === undefined ? {} : { cohort: snapshot.cohort }),
    ...(snapshot.trend === undefined ? {} : { trend: snapshot.trend }),
    evidenceId: snapshot.evidenceId,
    source: snapshot.source
  };
}

function createMetricInstrumentationTasks(input: {
  cwd: string;
  stateDb: string;
  metrics: string[];
  now: Date;
}): Task[] {
  const goals = listGoals({ cwd: input.cwd }).goals;
  const goal =
    goals.find(
      (item) => item.domain === "ai-native-startup" && item.status === "active"
    ) ?? goals.find((item) => item.status === "active");

  if (goal === undefined) {
    return [];
  }

  const createdAt = input.now.toISOString();
  const tasks = input.metrics.map((metric) => ({
    id: createRunsteadId("task"),
    goalId: goal.id,
    domain: goal.domain,
    type: "instrument_metric",
    status: "queued" as const,
    priority: "medium" as const,
    attempt: 0,
    maxAttempts: 1,
    input: {
      metric,
      acceptanceCriteria: [
        "metric source is connected",
        "threshold and current values are recorded",
        "freshness window is configured"
      ]
    },
    verifiers: ["evidence:startup_metric_snapshot"],
    createdAt,
    updatedAt: createdAt
  }));
  const database = openRunsteadDatabase(input.stateDb);

  try {
    for (const task of tasks) {
      appendEventAndProject(database, {
        event: {
          eventId: createRunsteadId("evt"),
          type: "task.created",
          aggregateType: "task",
          aggregateId: task.id,
          payload: {
            type: task.type,
            metric: task.input.metric
          },
          createdAt
        },
        projection: {
          type: "task",
          value: task
        }
      });
    }
  } finally {
    database.close();
  }

  return tasks;
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
