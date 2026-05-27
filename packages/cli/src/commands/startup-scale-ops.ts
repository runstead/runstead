import type { Command } from "commander";

import { collectValues } from "../startup-command-parsers.js";
import {
  runStartupScaleGtmVerifyCommand,
  runStartupScaleReportCommand,
  runStartupScaleScheduleReportCommand,
  runStartupScaleSopGenerateCommand,
  type StartupScaleGtmVerifyCommandOptions,
  type StartupScaleReportCommandOptions,
  type StartupScaleScheduleReportCommandOptions,
  type StartupScaleSopGenerateCommandOptions
} from "./startup-scale-ops-actions.js";

export function registerStartupScaleOpsCommands(startupScale: Command): void {
  startupScale
    .command("schedule-report")
    .description("Record the recurring scale report schedule.")
    .option("--cwd <path>", "Workspace directory")
    .option("--cadence <cadence>", "Schedule cadence", "weekly")
    .option("--owner <id>", "Schedule owner")
    .option("--next-run <date>", "Next run date or timestamp")
    .option("--period-template <template>", "Period template", "YYYY-WW")
    .option("--actor <id>", "RBAC subject for schedule writes", "local-admin")
    .action((options: StartupScaleScheduleReportCommandOptions) =>
      runStartupScaleScheduleReportCommand(options)
    );

  startupScale
    .command("report")
    .description("Generate recurring ops, engineering, and GTM evidence report.")
    .option("--cwd <path>", "Workspace directory")
    .option("--period <label>", "Report period label")
    .option("--actor <id>", "RBAC subject for scale report generation", "local-admin")
    .action((options: StartupScaleReportCommandOptions) =>
      runStartupScaleReportCommand(options)
    );

  startupScale
    .command("sop-generate")
    .description("Generate handoff-ready SOP artifacts.")
    .option("--cwd <path>", "Workspace directory")
    .option("--sop <text>", "SOP step or contract to record", collectValues, [])
    .option("--owner <text>", "SOP owner")
    .option("--workflow <text>", "Associated workflow")
    .option("--actor <id>", "RBAC subject for SOP generation", "local-admin")
    .action((options: StartupScaleSopGenerateCommandOptions) =>
      runStartupScaleSopGenerateCommand(options)
    );

  startupScale
    .command("gtm-verify")
    .description("Verify GTM claims against evidence and product state.")
    .option("--cwd <path>", "Workspace directory")
    .option("--claim <text>", "External GTM claim to verify", collectValues, [])
    .option("--evidence <ref>", "Evidence reference for the claim", collectValues, [])
    .option("--product-state <text>", "Current product state")
    .option("--actor <id>", "RBAC subject for GTM verification", "local-admin")
    .action((options: StartupScaleGtmVerifyCommandOptions) =>
      runStartupScaleGtmVerifyCommand(options)
    );
}
