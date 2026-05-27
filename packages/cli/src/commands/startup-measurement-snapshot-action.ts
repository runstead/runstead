import { requireRbacPermission } from "../cli-rbac.js";
import { evidenceSourceDetails } from "../startup-evidence-source-options.js";

export interface StartupMeasurementSnapshotCliOptions {
  cwd?: string;
  metric: string;
  source: string;
  threshold: string;
  current: string;
  sourceRef: string[];
  sourceUri?: string;
  sourceKind?: string;
  sourceClass?: string;
  confidence?: string;
  capturedAt?: string;
  freshnessDays?: string;
  sourceHash?: string;
  unit?: string;
  window?: string;
  cohort?: string;
  trend?: string;
  date?: string;
  falsePositive?: string;
  goal?: string;
  actor: string;
}

export async function recordStartupMeasurementSnapshotCommand(
  options: StartupMeasurementSnapshotCliOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "evidence.write",
    action: "record startup metric snapshot"
  });

  const { recordStartupMetricSnapshot } = await import("../startup-metrics.js");
  const result = await recordStartupMetricSnapshot({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    metric: options.metric,
    source: options.source,
    threshold: options.threshold,
    current: options.current,
    ...(options.sourceClass === undefined ? {} : { sourceClass: options.sourceClass }),
    ...(options.confidence === undefined ? {} : { confidence: options.confidence }),
    sourceRefs: options.sourceRef,
    ...evidenceSourceDetails(options),
    ...(options.unit === undefined ? {} : { unit: options.unit }),
    ...(options.window === undefined ? {} : { window: options.window }),
    ...(options.cohort === undefined ? {} : { cohort: options.cohort }),
    ...(options.trend === undefined ? {} : { trend: options.trend }),
    ...(options.date === undefined ? {} : { snapshotDate: options.date }),
    ...(options.falsePositive === undefined
      ? {}
      : { falsePositive: options.falsePositive }),
    ...(options.goal === undefined ? {} : { goalId: options.goal })
  });

  console.log(
    `Recorded metric snapshot evidence: ${result.metricEvidence.evidence.id}`
  );
  console.log(
    `Metric source class: ${result.confidenceProfile.sourceClass} confidence=${result.confidenceProfile.confidence} launch_weight=${result.confidenceProfile.launchWeight}`
  );
  console.log(`Artifact: ${result.metricEvidence.artifactPath}`);
  if (result.falsePositiveEvidence !== undefined) {
    console.log(
      `Recorded false-positive evidence: ${result.falsePositiveEvidence.evidence.id}`
    );
  }
}
