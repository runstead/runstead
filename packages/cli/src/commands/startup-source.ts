import type { Command } from "commander";

import { collectValues } from "../startup-command-parsers.js";
import {
  collectStartupSourceCommand,
  verifyStartupSourceCommand,
  type StartupSourceCollectCommandOptions,
  type StartupSourceVerifyCommandOptions
} from "./startup-source-actions.js";
import { listStartupSourceConnectorContracts } from "./startup-source-contracts.js";
import {
  recordStartupSourceCommand,
  type StartupSourceRecordCommandOptions
} from "./startup-source-record.js";

export function registerStartupSourceCommand(startup: Command): Command {
  const startupSource = startup
    .command("source")
    .description("Ingest startup evidence from external source connectors.");

  startupSource
    .command("list")
    .description("List startup source connector contracts.")
    .action(listStartupSourceConnectorContracts);

  addRecordCommand(startupSource);
  addVerifyCommand(startupSource);
  addCollectCommand(startupSource);

  return startupSource;
}

function addRecordCommand(startupSource: Command): void {
  startupSource
    .command("record")
    .description(
      "Record GitHub, deployment, analytics, support, billing, or security source evidence."
    )
    .option("--cwd <path>", "Workspace directory")
    .requiredOption(
      "--connector <kind>",
      "Connector: github_actions, github_pr, github_issue, vercel, fly, render, deployment, sentry, observability, posthog, analytics, billing, support, dependency"
    )
    .requiredOption("--source-uri <uri>", "Canonical source URI")
    .requiredOption("--summary <text>", "Evidence summary")
    .option("--status <status>", "Source status or outcome")
    .option(
      "--target <target>",
      "Readiness target this source supports: local, staging, or production"
    )
    .option("--captured-at <iso>", "Timestamp when the source was captured")
    .option("--freshness-days <days>", "Maximum acceptable source age in days")
    .option("--source-hash <hash>", "Optional hash of the captured source payload")
    .option(
      "--trust <level>",
      "Source trust level: low, medium, high, authoritative",
      "medium"
    )
    .option("--payload <json>", "Connector-specific JSON object payload")
    .option("--goal <id>", "Associated goal id")
    .option("--actor <id>", "RBAC subject for source evidence writes", "local-admin")
    .action(async (options: StartupSourceRecordCommandOptions) =>
      recordStartupSourceCommand(options)
    );
}

function addVerifyCommand(startupSource: Command): void {
  startupSource
    .command("verify")
    .description(
      "Verify a live GitHub, deployment, analytics, support, billing, or security source before recording evidence."
    )
    .option("--cwd <path>", "Workspace directory")
    .requiredOption(
      "--connector <kind>",
      "Connector: github_actions, github_pr, github_issue, vercel, fly, render, deployment, sentry, observability, posthog, analytics, billing, support, dependency"
    )
    .requiredOption("--source-uri <uri>", "Canonical source URI to verify")
    .option("--summary <text>", "Evidence summary")
    .option("--method <method>", "HTTP method to use for verification", "GET")
    .option("--expect-status <status>", "Expected HTTP status", "200")
    .option(
      "--expect-text <text>",
      "Response text that must be present; repeat for multiple checks",
      collectValues,
      []
    )
    .option(
      "--target <target>",
      "Readiness target this source supports: local, staging, or production"
    )
    .option("--captured-at <iso>", "Timestamp when the source was captured")
    .option("--freshness-days <days>", "Maximum acceptable source age in days")
    .option("--source-hash <hash>", "Optional hash of the captured source payload")
    .option("--trust <level>", "Source trust level: low, medium, high, authoritative")
    .option("--goal <id>", "Associated goal id")
    .option("--actor <id>", "RBAC subject for source evidence writes", "local-admin")
    .action(async (options: StartupSourceVerifyCommandOptions) =>
      verifyStartupSourceCommand(options)
    );
}

function addCollectCommand(startupSource: Command): void {
  startupSource
    .command("collect")
    .description(
      "Collect structured evidence from an executable provider adapter before recording it."
    )
    .option("--cwd <path>", "Workspace directory")
    .requiredOption(
      "--connector <kind>",
      "Executable connector: github_actions, vercel, render, sentry, or posthog"
    )
    .requiredOption("--source-uri <uri>", "Provider API URI to collect")
    .option(
      "--target <target>",
      "Readiness target this source supports: local, staging, or production"
    )
    .option("--token <token>", "Provider token; defaults to connector-specific env var")
    .option("--captured-at <iso>", "Timestamp when the source was captured")
    .option("--freshness-days <days>", "Maximum acceptable source age in days")
    .option("--source-hash <hash>", "Optional hash of the captured source payload")
    .option("--trust <level>", "Source trust level: low, medium, high, authoritative")
    .option("--goal <id>", "Associated goal id")
    .option("--actor <id>", "RBAC subject for source evidence writes", "local-admin")
    .action(async (options: StartupSourceCollectCommandOptions) =>
      collectStartupSourceCommand(options)
    );
}
