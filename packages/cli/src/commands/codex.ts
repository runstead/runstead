import type { Command } from "commander";

import {
  runCodexLoginCommand,
  runCodexLogoutCommand,
  runCodexModelsCommand,
  runCodexStatusCommand,
  type CodexCliOptions,
  type CodexLoginCliOptions,
  type CodexModelsCliOptions
} from "./codex-actions.js";

export function registerCodexCommand(program: Command): Command {
  const codex = program
    .command("codex")
    .description("Manage experimental Codex Direct provider credentials.");

  codex
    .command("login")
    .description("Authenticate the experimental Codex Direct provider.")
    .option("--runstead-home <path>", "Override RUNSTEAD_HOME for the auth store")
    .option("--base-url <url>", "Override the Codex backend base URL")
    .option(
      "--import-codex-cli",
      "Import an existing Codex CLI token once instead of starting device login"
    )
    .option("--yes", "Confirm explicit Codex CLI token import")
    .action((options: CodexLoginCliOptions) => runCodexLoginCommand(options));

  codex
    .command("status")
    .description("Show Codex Direct authentication status without printing tokens.")
    .option("--runstead-home <path>", "Override RUNSTEAD_HOME for the auth store")
    .action((options: CodexCliOptions) => runCodexStatusCommand(options));

  codex
    .command("logout")
    .description("Clear Codex Direct credentials from the Runstead auth store.")
    .option("--runstead-home <path>", "Override RUNSTEAD_HOME for the auth store")
    .action((options: CodexCliOptions) => runCodexLogoutCommand(options));

  codex
    .command("models")
    .description("List models available to the Codex Direct provider.")
    .option("--runstead-home <path>", "Override RUNSTEAD_HOME for the auth store")
    .option("--refresh", "Force an access-token refresh before listing models")
    .action((options: CodexModelsCliOptions) => runCodexModelsCommand(options));

  return codex;
}
