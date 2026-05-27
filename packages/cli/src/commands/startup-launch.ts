import type { Command } from "commander";

import {
  registerBottleneckMapCommand,
  registerSupportTriageCommand
} from "./startup-launch-ops.js";
import {
  runStartupLaunchAuditCommand,
  runStartupLaunchGitSummaryCommand,
  runStartupLaunchPrepareCommand,
  runStartupLaunchReportCommand,
  runStartupLaunchSecurityBaselineCommand,
  type StartupLaunchAuditCommandOptions,
  type StartupLaunchGitSummaryCommandOptions,
  type StartupLaunchPrepareCommandOptions,
  type StartupLaunchReportCommandOptions,
  type StartupLaunchSecurityBaselineCommandOptions
} from "./startup-launch-readiness.js";
import {
  registerUiTestScaffoldCommand,
  registerUiValidateCommand
} from "./startup-launch-ui.js";

export function registerStartupLaunchCommand(startup: Command): Command {
  const startupLaunch = startup
    .command("launch")
    .description("Generate startup launch readiness artifacts.");

  registerAuditCommand(startupLaunch);
  registerSecurityBaselineCommand(startupLaunch);
  registerPrepareCommand(startupLaunch);
  registerReportCommand(startupLaunch);
  registerSupportTriageCommand(startupLaunch);
  registerGitSummaryCommand(startupLaunch);
  registerUiValidateCommand(startupLaunch);
  registerUiTestScaffoldCommand(startupLaunch);
  registerBottleneckMapCommand(startupLaunch);

  return startupLaunch;
}

function registerAuditCommand(startupLaunch: Command): void {
  startupLaunch
    .command("audit")
    .description("Inspect repo readiness and record launch audit evidence.")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for launch audit generation", "local-admin")
    .action(async (options: StartupLaunchAuditCommandOptions) =>
      runStartupLaunchAuditCommand(options)
    );
}

function registerSecurityBaselineCommand(startupLaunch: Command): void {
  startupLaunch
    .command("security-baseline")
    .description("Record protected-path, env, and dependency baseline evidence.")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--actor <id>",
      "RBAC subject for security baseline generation",
      "local-admin"
    )
    .action(async (options: StartupLaunchSecurityBaselineCommandOptions) =>
      runStartupLaunchSecurityBaselineCommand(options)
    );
}

function registerPrepareCommand(startupLaunch: Command): void {
  startupLaunch
    .command("prepare")
    .description("Prepare launch readiness artifacts and generate a readiness report.")
    .option("--cwd <path>", "Workspace directory")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .option("--actor <id>", "RBAC subject for launch preparation", "local-admin")
    .action(async (options: StartupLaunchPrepareCommandOptions) =>
      runStartupLaunchPrepareCommand(options)
    );
}

function registerReportCommand(startupLaunch: Command): void {
  startupLaunch
    .command("report")
    .description("Generate the startup launch readiness report.")
    .option("--cwd <path>", "Workspace directory")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .option("--print", "Print the generated markdown")
    .option("--actor <id>", "RBAC subject for report generation", "local-admin")
    .action((options: StartupLaunchReportCommandOptions) =>
      runStartupLaunchReportCommand(options)
    );
}

function registerGitSummaryCommand(startupLaunch: Command): void {
  startupLaunch
    .command("git-summary")
    .description("Generate first commit, push, PR, and GitHub Actions launch guidance.")
    .option("--cwd <path>", "Workspace directory")
    .option("--remote <name>", "Git remote to inspect", "origin")
    .option("--actor <id>", "RBAC subject for Git/GitHub launch summary", "local-admin")
    .action(async (options: StartupLaunchGitSummaryCommandOptions) =>
      runStartupLaunchGitSummaryCommand(options)
    );
}
