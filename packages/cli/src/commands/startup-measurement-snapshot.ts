import type { Command } from "commander";

import { collectValues } from "../startup-command-parsers.js";
import { recordStartupMeasurementSnapshotCommand } from "./startup-measurement-snapshot-action.js";

export function registerStartupMeasurementSnapshotCommand(
  startupMeasurement: Command
): void {
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
    .action(recordStartupMeasurementSnapshotCommand);
}
