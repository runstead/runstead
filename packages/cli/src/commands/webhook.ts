import type { Command } from "commander";

import { collectValues } from "../cli-parsers.js";
import {
  runWebhookServeCommand,
  type WebhookServeCommandOptions
} from "./webhook-actions.js";

export function registerWebhookCommand(program: Command): Command {
  const webhook = program
    .command("webhook")
    .description("Run webhook receivers. Experimental.");

  webhook
    .command("serve")
    .description("Serve the GitHub webhook endpoint.")
    .option("--host <host>", "Host to bind", "127.0.0.1")
    .option("--port <number>", "Port to bind", "8787")
    .option("--cwd <path>", "Workspace directory")
    .option("--secret <secret>", "GitHub webhook secret")
    .option("--allow-unsigned", "Allow unsigned webhook requests")
    .option("--github-app", "Use configured GitHub App installation auth")
    .option("--installation-id <id>", "Override configured GitHub App installation id")
    .option(
      "--orchestrate-repair",
      "Run the governed CI repair loop for repairable workflow_run events"
    )
    .option(
      "--worker <worker>",
      "Worker to run when orchestrating repairs",
      "codex_cli"
    )
    .option("--provider <provider>", "Model provider to use with codex_direct")
    .option(
      "--model <model>",
      "Model to use with codex_direct, codex_cli, or claude_code"
    )
    .option("--base-url <url>", "Model provider base URL")
    .option("--base <ref>", "PR base branch when orchestrating repairs")
    .option("--draft", "Create draft pull requests when orchestrating repairs")
    .option(
      "--allowed <pattern>",
      "Allowed changed path pattern when orchestrating repairs",
      collectValues,
      []
    )
    .option(
      "--denied <pattern>",
      "Denied changed path pattern when orchestrating repairs",
      collectValues,
      []
    )
    .option(
      "--verifier <name=command>",
      "Verifier command for orchestrated repairs",
      collectValues,
      []
    )
    .option("--actor <id>", "RBAC subject for webhook management", "local-admin")
    .action((options: WebhookServeCommandOptions) => runWebhookServeCommand(options));

  return webhook;
}
