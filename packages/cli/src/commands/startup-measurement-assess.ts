import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import { collectValues } from "../startup-command-parsers.js";

export function registerStartupMeasurementAssessCommand(
  startupMeasurement: Command
): void {
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
