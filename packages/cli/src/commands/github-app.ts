import type { Command } from "commander";

import {
  runGitHubAppInitCommand,
  runGitHubAppJwtCommand,
  runGitHubAppStatusCommand,
  runGitHubAppTokenCommand,
  type GitHubAppInitCommandOptions,
  type GitHubAppJwtCommandOptions,
  type GitHubAppStatusCommandOptions,
  type GitHubAppTokenCommandOptions
} from "./github-app-actions.js";

export function addGitHubAppCommands(github: Command): Command {
  const githubApp = github
    .command("app")
    .description("Use GitHub App mode. Experimental.");

  githubApp
    .command("init")
    .description("Configure GitHub App mode.")
    .requiredOption("--app-id <id>", "GitHub App id")
    .requiredOption("--private-key <path>", "GitHub App private key PEM path")
    .option("--cwd <path>", "Workspace directory")
    .option("--installation-id <id>", "GitHub App installation id")
    .option("--api-base-url <url>", "GitHub API base URL")
    .option("--force", "Overwrite an existing GitHub App config")
    .option("--actor <id>", "RBAC subject for GitHub App management", "local-admin")
    .action((commandOptions: GitHubAppInitCommandOptions) =>
      runGitHubAppInitCommand(commandOptions)
    );

  githubApp
    .command("status")
    .description("Show GitHub App mode configuration.")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for GitHub App management", "local-admin")
    .action((commandOptions: GitHubAppStatusCommandOptions) =>
      runGitHubAppStatusCommand(commandOptions)
    );

  githubApp
    .command("jwt")
    .description("Print a signed GitHub App JWT.")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for GitHub App management", "local-admin")
    .option(
      "--print-secret",
      "Acknowledge that the GitHub App JWT will be printed to stdout"
    )
    .action((commandOptions: GitHubAppJwtCommandOptions) =>
      runGitHubAppJwtCommand(commandOptions)
    );

  githubApp
    .command("token")
    .description("Print a GitHub App installation access token.")
    .option("--cwd <path>", "Workspace directory")
    .option("--installation-id <id>", "Override configured GitHub App installation id")
    .option("--actor <id>", "RBAC subject for GitHub App management", "local-admin")
    .option(
      "--print-secret",
      "Acknowledge that the installation access token will be printed to stdout"
    )
    .action((commandOptions: GitHubAppTokenCommandOptions) =>
      runGitHubAppTokenCommand(commandOptions)
    );

  return githubApp;
}
