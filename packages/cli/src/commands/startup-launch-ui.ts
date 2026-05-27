import type { Command } from "commander";

import { collectValues } from "../startup-command-parsers.js";
import {
  runStartupLaunchUiTestScaffoldCommand,
  runStartupLaunchUiValidateCommand,
  type StartupLaunchUiTestScaffoldCommandOptions,
  type StartupLaunchUiValidateCommandOptions
} from "./startup-launch-ui-actions.js";

export function registerUiValidateCommand(startupLaunch: Command): void {
  startupLaunch
    .command("ui-validate")
    .description(
      "Record screenshot, DOM, accessibility, responsive, and flow UI validation evidence."
    )
    .option("--cwd <path>", "Workspace directory")
    .option("--url <url>", "Validated local or deployed URL")
    .requiredOption("--viewport <viewport>", "Viewport label or dimensions")
    .option(
      "--execute",
      "Run an automated DOM/UI validation smoke before recording evidence"
    )
    .option("--server-command <command>", "Command used to start a local dev server")
    .option("--server-port <port>", "Preferred local dev server port")
    .option("--execute-timeout-ms <ms>", "Dev server startup timeout in milliseconds")
    .option(
      "--expect-text <text>",
      "Text that must appear in the executed DOM",
      collectValues,
      []
    )
    .option("--screenshot <ref>", "Screenshot artifact URI or path")
    .option("--dom <status>", "DOM smoke status: pass, fail, or not_run", "not_run")
    .option(
      "--accessibility <status>",
      "Accessibility check status: pass, fail, or not_run",
      "not_run"
    )
    .option(
      "--responsive <status>",
      "Responsive viewport status: pass, fail, or not_run",
      "not_run"
    )
    .option("--flow <name>", "Critical user flow name")
    .option(
      "--flow-status <status>",
      "Critical flow status: pass, fail, or not_run",
      "not_run"
    )
    .option("--source <ref>", "Evidence source reference", collectValues, [])
    .option("--source-uri <uri>", "Canonical browser/UI source URI")
    .option("--source-kind <kind>", "Source kind, usually browser_ui")
    .option("--captured-at <iso>", "Timestamp when the source was captured")
    .option("--freshness-days <days>", "Maximum acceptable source age in days")
    .option("--source-hash <hash>", "Optional hash of the captured source payload")
    .option("--goal <id>", "Associated goal id")
    .option("--actor <id>", "RBAC subject for UI validation writes", "local-admin")
    .action((options: StartupLaunchUiValidateCommandOptions) =>
      runStartupLaunchUiValidateCommand(options)
    );
}

export function registerUiTestScaffoldCommand(startupLaunch: Command): void {
  startupLaunch
    .command("ui-test-scaffold")
    .description("Generate a project DOM/UI smoke test scaffold for MVP flows.")
    .option("--cwd <path>", "Workspace directory")
    .option("--url <url>", "Default UI URL for the generated smoke test")
    .option("--test-path <path>", "Test file path to write")
    .option("--flow <name>", "Critical user flow name")
    .option(
      "--expect-text <text>",
      "Text expected in the rendered UI",
      collectValues,
      []
    )
    .option("--actor <id>", "RBAC subject for UI test scaffold writes", "local-admin")
    .action((options: StartupLaunchUiTestScaffoldCommandOptions) =>
      runStartupLaunchUiTestScaffoldCommand(options)
    );
}
