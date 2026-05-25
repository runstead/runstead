import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import { collectValues } from "../startup-command-parsers.js";
import { evidenceSourceDetails } from "../startup-evidence-source-options.js";

export function registerStartupMeasurementCommand(startup: Command): Command {
  const startupMeasurement = startup
    .command("measurement")
    .description("Generate startup measurement framework artifacts.");

  registerGenerateCommand(startupMeasurement);
  registerSnapshotCommand(startupMeasurement);
  registerAssessCommand(startupMeasurement);

  return startupMeasurement;
}

function registerGenerateCommand(startupMeasurement: Command): void {
  startupMeasurement
    .command("generate")
    .description("Generate MEASUREMENT.md and evidence-backed metric contracts.")
    .option("--cwd <path>", "Workspace directory")
    .option("--force", "Overwrite existing measurement framework")
    .option("--activation <text>", "Activation metric")
    .option("--retention <text>", "Retention metric")
    .option("--day7 <text>", "Day 7 metric")
    .option("--day30 <text>", "Day 30 metric")
    .option("--false-positive <text>", "False-positive metric")
    .option("--actor <id>", "RBAC subject for measurement generation", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        force?: boolean;
        activation?: string;
        retention?: string;
        day7?: string;
        day30?: string;
        falsePositive?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "generate startup measurement framework"
        });

        const { generateMeasurementFramework } =
          await import("../startup-automation.js");
        const result = await generateMeasurementFramework({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          force: options.force === true,
          ...(options.activation === undefined
            ? {}
            : { activationMetric: options.activation }),
          ...(options.retention === undefined
            ? {}
            : { retentionMetric: options.retention }),
          ...(options.day7 === undefined ? {} : { day7Metric: options.day7 }),
          ...(options.day30 === undefined ? {} : { day30Metric: options.day30 }),
          ...(options.falsePositive === undefined
            ? {}
            : { falsePositiveMetric: options.falsePositive })
        });

        console.log(`Generated measurement evidence: ${result.evidenceId}`);
        for (const file of result.files) {
          console.log(`Wrote measurement file: ${file}`);
        }
        logStructuredFiles(result.structuredFiles);
      }
    );
}

function registerSnapshotCommand(startupMeasurement: Command): void {
  startupMeasurement
    .command("snapshot")
    .description("Record a metric snapshot from analytics, query, CSV, or manual data.")
    .option("--cwd <path>", "Workspace directory")
    .requiredOption(
      "--metric <name>",
      "Metric name, such as activation or d7_retention"
    )
    .requiredOption(
      "--source <source>",
      "Metric source, such as PostHog, SQL, CSV, or manual"
    )
    .requiredOption("--threshold <value>", "Launch threshold for the metric")
    .requiredOption("--current <value>", "Current metric value")
    .option("--source-ref <ref>", "Evidence source reference", collectValues, [])
    .option("--source-uri <uri>", "Canonical analytics, query, CSV, or BI source URI")
    .option("--source-kind <kind>", "Source kind, such as posthog, sql, csv, or manual")
    .option(
      "--source-class <class>",
      "Metric evidence class: synthetic_smoke, founder_manual, or analytics_real_user"
    )
    .option("--confidence <score>", "Metric confidence score from 0 to 1")
    .option("--captured-at <iso>", "Timestamp when the source was captured")
    .option("--freshness-days <days>", "Maximum acceptable source age in days")
    .option("--source-hash <hash>", "Optional hash of the captured source payload")
    .option("--unit <unit>", "Metric unit")
    .option("--window <window>", "Measurement window")
    .option("--cohort <cohort>", "Metric cohort")
    .option("--trend <trend>", "Metric trend, such as up, flat, or down")
    .option("--date <date>", "Snapshot date or timestamp")
    .option(
      "--false-positive <text>",
      "False-positive control or observed false-positive record"
    )
    .option("--goal <id>", "Associated goal id")
    .option("--actor <id>", "RBAC subject for metric snapshot writes", "local-admin")
    .action(
      async (options: {
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
      }) => {
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
          ...(options.sourceClass === undefined
            ? {}
            : { sourceClass: options.sourceClass }),
          ...(options.confidence === undefined
            ? {}
            : { confidence: options.confidence }),
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
    );
}

function registerAssessCommand(startupMeasurement: Command): void {
  startupMeasurement
    .command("assess")
    .description(
      "Assess required launch metrics for missing, stale, or below-threshold data."
    )
    .option("--cwd <path>", "Workspace directory")
    .option("--metric <name>", "Required metric", collectValues, [])
    .option("--create-tasks", "Create instrumentation tasks for missing metrics")
    .option("--actor <id>", "RBAC subject for metric assessment", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        metric: string[];
        createTasks?: boolean;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.read",
          action: "assess startup metrics"
        });

        const { assessStartupMetrics } = await import("../startup-metrics.js");
        const result = await assessStartupMetrics({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.metric.length === 0 ? {} : { requiredMetrics: options.metric }),
          createTasks: options.createTasks === true
        });

        console.log("Startup measurement assessment");
        for (const metric of result.metrics) {
          console.log(
            `- ${metric.metric}: ${metric.status}${metric.evidenceId === undefined ? "" : ` evidence=${metric.evidenceId}`}`
          );
        }
        console.log(`Instrumentation tasks: ${result.instrumentationTasks.length}`);
      }
    );
}

function logStructuredFiles(files: string[]): void {
  for (const file of files) {
    console.log(`Wrote structured artifact: ${file}`);
  }
}
