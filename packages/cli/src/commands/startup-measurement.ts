import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import { collectValues } from "../startup-command-parsers.js";
import { registerStartupMeasurementSnapshotCommand } from "./startup-measurement-snapshot.js";

export function registerStartupMeasurementCommand(startup: Command): Command {
  const startupMeasurement = startup
    .command("measurement")
    .description("Generate startup measurement framework artifacts.");

  registerGenerateCommand(startupMeasurement);
  registerStartupMeasurementSnapshotCommand(startupMeasurement);
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
