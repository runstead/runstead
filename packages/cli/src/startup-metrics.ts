import {
  addStartupEvidence,
  type AddStartupEvidenceResult,
  type StartupEvidenceSourceInput
} from "./startup-evidence.js";

export interface RecordStartupMetricSnapshotOptions {
  cwd?: string;
  metric: string;
  source: string;
  threshold: string;
  current: string;
  sourceRefs?: string[];
  sources?: StartupEvidenceSourceInput[];
  unit?: string;
  window?: string;
  snapshotDate?: string;
  goalId?: string;
  falsePositive?: string;
  now?: Date;
}

export interface RecordStartupMetricSnapshotResult {
  metricEvidence: AddStartupEvidenceResult;
  falsePositiveEvidence?: AddStartupEvidenceResult;
}

export async function recordStartupMetricSnapshot(
  options: RecordStartupMetricSnapshotOptions
): Promise<RecordStartupMetricSnapshotResult> {
  const snapshotDate =
    options.snapshotDate ?? (options.now ?? new Date()).toISOString();
  const content = {
    metric: options.metric,
    source: options.source,
    threshold: parseMetricValue(options.threshold),
    current: parseMetricValue(options.current),
    snapshotDate,
    ...(options.unit === undefined ? {} : { unit: options.unit }),
    ...(options.window === undefined ? {} : { window: options.window }),
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
    summary: `${options.metric} metric snapshot: current=${options.current}, threshold=${options.threshold}`,
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
    ...(falsePositiveEvidence === undefined ? {} : { falsePositiveEvidence })
  };
}

function parseMetricValue(value: string): string | number {
  const numeric = Number(value);

  return value.trim() !== "" && Number.isFinite(numeric) ? numeric : value;
}
