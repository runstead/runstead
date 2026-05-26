import { addStartupEvidence } from "./startup-evidence.js";
import { resolveStartupMetricConfidenceProfile } from "./startup-metric-confidence.js";
import type {
  RecordStartupMetricSnapshotOptions,
  RecordStartupMetricSnapshotResult
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

function parseMetricValue(value: string): string | number {
  const numeric = Number(value);

  return value.trim() !== "" && Number.isFinite(numeric) ? numeric : value;
}
