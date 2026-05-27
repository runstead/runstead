import type { Command } from "commander";

import {
  runRepoAddCommand,
  runRepoArchiveCommand,
  runRepoListCommand,
  runRepoShowCommand,
  type RepoAddCommandOptions,
  type RepoArchiveCommandOptions,
  type RepoListCommandOptions,
  type RepoShowCommandOptions
} from "./repo-actions.js";

export function registerRepoCommand(program: Command): Command {
  const repo = program.command("repo").description("Manage registered repositories.");

  repo
    .command("add")
    .description("Register a repository for multi-repo operation.")
    .argument("[path]", "Repository path")
    .option("--cwd <path>", "Runstead control workspace directory")
    .option("--alias <alias>", "Stable repository alias")
    .option("--remote-url <url>", "Override detected remote URL")
    .option("--default-branch <branch>", "Override detected branch")
    .option("--tags <list>", "Comma-separated tags")
    .option("--actor <id>", "RBAC subject for repository management", "local-admin")
    .action((path: string | undefined, options: RepoAddCommandOptions) =>
      runRepoAddCommand(path, options)
    );

  repo
    .command("list")
    .description("List registered repositories.")
    .option("--cwd <path>", "Runstead control workspace directory")
    .option("--status <status>", "Filter by repository status")
    .option("--actor <id>", "RBAC subject for repository access", "local-admin")
    .action((options: RepoListCommandOptions) => runRepoListCommand(options));

  repo
    .command("show")
    .description("Show a registered repository.")
    .argument("<ref>", "Repository id, alias, or path")
    .option("--cwd <path>", "Runstead control workspace directory")
    .option("--actor <id>", "RBAC subject for repository access", "local-admin")
    .action((ref: string, options: RepoShowCommandOptions) =>
      runRepoShowCommand(ref, options)
    );

  repo
    .command("archive")
    .description("Archive a registered repository without deleting audit history.")
    .argument("<ref>", "Repository id, alias, or path")
    .option("--cwd <path>", "Runstead control workspace directory")
    .option("--actor <id>", "RBAC subject for repository management", "local-admin")
    .action((ref: string, options: RepoArchiveCommandOptions) =>
      runRepoArchiveCommand(ref, options)
    );

  return repo;
}
