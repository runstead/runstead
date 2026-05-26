import type { Task } from "@runstead/core";

import type {
  AddStartupEvidenceResult,
  StartupEvidenceSourceInput
} from "./startup-evidence.js";
import type {
  StartupMetricConfidenceProfile,
  StartupMetricSourceClass
} from "./startup-metric-confidence.js";

export interface RecordStartupMetricSnapshotOptions {
  cwd?: string;
  metric: string;
  source: string;
  threshold: string;
  current: string;
  sourceClass?: string;
  confidence?: string | number;
  sourceRefs?: string[];
  sources?: StartupEvidenceSourceInput[];
  unit?: string;
  window?: string;
  cohort?: string;
  trend?: string;
  snapshotDate?: string;
  goalId?: string;
  falsePositive?: string;
  now?: Date;
}

export interface RecordStartupMetricSnapshotResult {
  metricEvidence: AddStartupEvidenceResult;
  confidenceProfile: StartupMetricConfidenceProfile;
  falsePositiveEvidence?: AddStartupEvidenceResult;
}

export interface AssessStartupMetricsOptions {
  cwd?: string;
  requiredMetrics?: string[];
  createTasks?: boolean;
  now?: Date;
}

export interface AssessStartupMetricsResult {
  root: string;
  stateDb: string;
  requiredMetrics: string[];
  metrics: StartupMetricAssessment[];
  missingMetrics: string[];
  belowThresholdMetrics: string[];
  staleMetrics: string[];
  instrumentationTasks: Task[];
}

export interface StartupMetricAssessment {
  metric: string;
  status: "ok" | "missing" | "below_threshold" | "stale";
  current?: number | string;
  threshold?: number | string;
  sourceClass?: StartupMetricSourceClass;
  confidence?: number;
  launchWeight?: number;
  realUserData?: boolean;
  window?: string;
  cohort?: string;
  trend?: string;
  evidenceId?: string;
  source?: string;
}

export interface MetricSnapshotRow {
  id: string;
  uri: string;
  created_at: string;
}

export interface MetricSnapshotArtifact {
  sources?: unknown;
  content?: unknown;
}

export interface ParsedMetricSnapshot {
  evidenceId: string;
  metric: string;
  source: string;
  current: number | string;
  threshold: number | string;
  sourceClass: StartupMetricSourceClass;
  confidence: number;
  launchWeight: number;
  realUserData: boolean;
  window?: string;
  cohort?: string;
  trend?: string;
  stale: boolean;
  createdAt: string;
}
