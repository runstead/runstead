import type { Command } from "commander";

import { collectValues } from "../cli-parsers.js";
import { addCiRepairOrchestrationCommand } from "./ci-repair.js";
import {
  runGitHubRunLogsCommand,
  runGitHubRunRepairCommand,
  runGitHubRunStatusCommand,
  type GitHubRunAuthCommandOptions,
  type GitHubRunRepairCommandOptions
} from "./github-run-actions.js";

export function registerGitHubRunCommand(github: Command): Command {
  const githubRun = github.command("run").description("Inspect GitHub workflow runs.");

  githubRun
    .command("status")
    .description(
      "Show GitHub workflow run status. Unmanaged helper; governed reads run through CI repair intake."
    )
    .argument("<run-id>", "GitHub Actions workflow run id")
    .option("--cwd <path>", "Workspace directory")
    .option("--github-app", "Use configured GitHub App installation auth")
    .option("--installation-id <id>", "Override configured GitHub App installation id")
    .option("--actor <id>", "RBAC subject for GitHub run access", "local-admin")
    .action((runId: string, commandOptions: GitHubRunAuthCommandOptions) =>
      runGitHubRunStatusCommand(runId, commandOptions)
    );

  githubRun
    .command("logs")
    .description(
      "Print GitHub workflow run logs. Unmanaged helper; governed reads run through CI repair intake."
    )
    .argument("<run-id>", "GitHub Actions workflow run id")
    .option("--cwd <path>", "Workspace directory")
    .option("--github-app", "Use configured GitHub App installation auth")
    .option("--installation-id <id>", "Override configured GitHub App installation id")
    .option("--actor <id>", "RBAC subject for GitHub run access", "local-admin")
    .action((runId: string, commandOptions: GitHubRunAuthCommandOptions) =>
      runGitHubRunLogsCommand(runId, commandOptions)
    );

  githubRun
    .command("repair")
    .description("Create a CI repair task from a failed GitHub workflow run.")
    .argument("<run-id>", "GitHub Actions workflow run id")
    .option("--cwd <path>", "Workspace directory")
    .option("--github-app", "Use configured GitHub App installation auth")
    .option("--installation-id <id>", "Override configured GitHub App installation id")
    .option("--actor <id>", "RBAC subject for repair task creation", "local-admin")
    .option(
      "--verifier <name=command>",
      "Verifier command to store on the CI repair task",
      collectValues,
      []
    )
    .action((runId: string, commandOptions: GitHubRunRepairCommandOptions) =>
      runGitHubRunRepairCommand(runId, commandOptions)
    );

  addCiRepairOrchestrationCommand(
    githubRun
      .command("orchestrate-repair")
      .description("Run the CI repair branch, worker, verifier, and PR loop.")
  );

  return githubRun;
}
