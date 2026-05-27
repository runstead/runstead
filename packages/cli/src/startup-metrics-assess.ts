import { createRunsteadId, type Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { listGoals } from "./goals.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { readMetricSnapshots } from "./startup-metrics-snapshots.js";
import type {
  AssessStartupMetricsOptions,
  AssessStartupMetricsResult,
  ParsedMetricSnapshot,
  StartupMetricAssessment
} from "./startup-metrics-types.js";

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
