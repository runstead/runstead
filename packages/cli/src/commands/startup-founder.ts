import type { Command } from "commander";

import { collectValues } from "../startup-command-parsers.js";
import {
  runStartupFounderBuildMvpCommand,
  runStartupFounderLaunchCheckCommand,
  runStartupFounderOnboardCommand,
  runStartupFounderScaleCheckCommand,
  type StartupFounderBuildMvpCommandOptions,
  type StartupFounderCheckCommandOptions,
  type StartupFounderOnboardCommandOptions
} from "./startup-founder-actions.js";

export function registerStartupFounderCommands(startup: Command): void {
  registerOnboardCommand(startup);
  registerBuildMvpCommand(startup);
  registerLaunchCheckCommand(startup);
  registerScaleCheckCommand(startup);
}

function registerOnboardCommand(startup: Command): void {
  startup
    .command("onboard")
    .description("Run the short founder onboarding path for an AI-coded MVP repo.")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--profile <profile>",
      "Policy profile to generate when Runstead is not initialized: default or trusted-local",
      "trusted-local"
    )
    .option("--force", "Overwrite generated context and measurement artifacts")
    .option("--write-ci", "Generate a GitHub Actions verifier workflow")
    .action(async (options: StartupFounderOnboardCommandOptions) =>
      runStartupFounderOnboardCommand(options)
    );
}

function registerBuildMvpCommand(startup: Command): void {
  startup
    .command("build-mvp")
    .description("Run the short founder MVP build path with a local agent worker.")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--worker <worker>",
      "Worker: codex_direct, codex_cli, or claude_code",
      "codex_cli"
    )
    .option("--model <model>", "Model override for worker execution")
    .option("--prompt <text>", "Override the default MVP build prompt")
    .option(
      "--dependency-policy <policy>",
      "Dependency policy: approval-required, allow-listed, or deny-new",
      "approval-required"
    )
    .option(
      "--allow-dependency <name>",
      "Allowed dependency package or class when --dependency-policy allow-listed",
      collectValues,
      []
    )
    .option("--max-attempts <count>", "Maximum bounded MVP repair attempts", "2")
    .option("--max-turns <count>", "Maximum codex_direct turns per MVP attempt", "24")
    .action(async (options: StartupFounderBuildMvpCommandOptions) =>
      runStartupFounderBuildMvpCommand(options)
    );
}

function registerLaunchCheckCommand(startup: Command): void {
  startup
    .command("launch-check")
    .description("Run the short founder launch readiness check path.")
    .option("--cwd <path>", "Workspace directory")
    .action((options: StartupFounderCheckCommandOptions) =>
      runStartupFounderLaunchCheckCommand(options)
    );
}

function registerScaleCheckCommand(startup: Command): void {
  startup
    .command("scale-check")
    .description("Run the short founder scale readiness check path.")
    .option("--cwd <path>", "Workspace directory")
    .action((options: StartupFounderCheckCommandOptions) =>
      runStartupFounderScaleCheckCommand(options)
    );
}
