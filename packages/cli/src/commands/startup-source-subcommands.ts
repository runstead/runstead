import type { Command } from "commander";

import { collectValues } from "../startup-command-parsers.js";
import {
  collectStartupSourceCommand,
  type StartupSourceCollectCommandOptions
} from "./startup-source-collect.js";
import {
  recordStartupSourceCommand,
  type StartupSourceRecordCommandOptions
} from "./startup-source-record.js";
import {
  verifyStartupSourceCommand,
  type StartupSourceVerifyCommandOptions
} from "./startup-source-verify.js";

const STARTUP_SOURCE_CONNECTOR_HELP =
  "Connector: github_actions, gitlab_ci, ci, github_pr, gitlab_merge_request, github_issue, linear, jira, slack, docs, vercel, fly, render, deployment, sentry, observability, posthog, analytics, billing, support, dependency";
const STARTUP_SOURCE_EXECUTABLE_CONNECTOR_HELP =
  "Executable connector: github_actions, gitlab_ci, gitlab_merge_request, linear, jira, slack, docs, vercel, render, sentry, or posthog";

export function addStartupSourceRecordCommand(startupSource: Command): void {
  startupSource
    .command("record")
    .description(
      "Record GitHub, deployment, analytics, support, billing, or security source evidence."
    )
    .option("--cwd <path>", "Workspace directory")
    .requiredOption("--connector <kind>", STARTUP_SOURCE_CONNECTOR_HELP)
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
    .action((options: StartupSourceRecordCommandOptions) =>
      recordStartupSourceCommand(options)
    );
}

export function addStartupSourceVerifyCommand(startupSource: Command): void {
  startupSource
    .command("verify")
    .description(
      "Verify a live GitHub, deployment, analytics, support, billing, or security source before recording evidence."
    )
    .option("--cwd <path>", "Workspace directory")
    .requiredOption("--connector <kind>", STARTUP_SOURCE_CONNECTOR_HELP)
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
    .action((options: StartupSourceVerifyCommandOptions) =>
      verifyStartupSourceCommand(options)
    );
}

export function addStartupSourceCollectCommand(startupSource: Command): void {
  startupSource
    .command("collect")
    .description(
      "Collect structured evidence from an executable provider adapter before recording it."
    )
    .option("--cwd <path>", "Workspace directory")
    .requiredOption("--connector <kind>", STARTUP_SOURCE_EXECUTABLE_CONNECTOR_HELP)
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
    .action((options: StartupSourceCollectCommandOptions) =>
      collectStartupSourceCommand(options)
    );
}
