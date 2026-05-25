import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";

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
    .action(
      async (
        path: string | undefined,
        options: {
          cwd?: string;
          alias?: string;
          remoteUrl?: string;
          defaultBranch?: string;
          tags?: string;
          actor: string;
        }
      ) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "repo.manage",
          action: "manage repositories"
        });

        const { registerRepository } = await import("../repositories.js");
        const result = await registerRepository({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(path === undefined ? {} : { path }),
          ...(options.alias === undefined ? {} : { alias: options.alias }),
          ...(options.remoteUrl === undefined ? {} : { remoteUrl: options.remoteUrl }),
          ...(options.defaultBranch === undefined
            ? {}
            : { defaultBranch: options.defaultBranch }),
          ...(options.tags === undefined
            ? {}
            : { tags: parseCommaSeparatedList(options.tags) })
        });

        console.log(
          `${result.created ? "Registered" : "Updated"} repository: ${result.repository.alias}`
        );
        console.log(`ID: ${result.repository.id}`);
        console.log(`Path: ${result.repository.localPath}`);
      }
    );

  repo
    .command("list")
    .description("List registered repositories.")
    .option("--cwd <path>", "Runstead control workspace directory")
    .option("--status <status>", "Filter by repository status")
    .option("--actor <id>", "RBAC subject for repository access", "local-admin")
    .action(async (options: { cwd?: string; status?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "repo.read",
        action: "list repositories"
      });

      const { listRepositories } = await import("../repositories.js");
      const status = parseRepositoryStatus(options.status);
      const result = listRepositories({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(status === undefined ? {} : { status })
      });

      if (result.repositories.length === 0) {
        console.log("No repositories found.");
        return;
      }

      for (const item of result.repositories) {
        console.log(
          `${item.status.padEnd(8)} ${item.id} ${item.alias} ${item.localPath}`
        );
      }
    });

  repo
    .command("show")
    .description("Show a registered repository.")
    .argument("<ref>", "Repository id, alias, or path")
    .option("--cwd <path>", "Runstead control workspace directory")
    .option("--actor <id>", "RBAC subject for repository access", "local-admin")
    .action(async (ref: string, options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "repo.read",
        action: "inspect repositories"
      });

      const { showRepository } = await import("../repositories.js");
      const result = showRepository({ ...options, ref });

      console.log(`Repository: ${result.repository.id}`);
      console.log(`Alias: ${result.repository.alias}`);
      console.log(`Status: ${result.repository.status}`);
      console.log(`Path: ${result.repository.localPath}`);
      console.log(`Remote: ${result.repository.remoteUrl ?? "none"}`);
      console.log(`Default branch: ${result.repository.defaultBranch ?? "unknown"}`);
      console.log(`Tags: ${result.repository.tags.join(", ") || "none"}`);
    });

  repo
    .command("archive")
    .description("Archive a registered repository without deleting audit history.")
    .argument("<ref>", "Repository id, alias, or path")
    .option("--cwd <path>", "Runstead control workspace directory")
    .option("--actor <id>", "RBAC subject for repository management", "local-admin")
    .action(async (ref: string, options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "repo.manage",
        action: "manage repositories"
      });

      const { archiveRepository } = await import("../repositories.js");
      const result = archiveRepository({ ...options, ref });

      console.log(`Archived repository: ${result.repository.alias}`);
      console.log(`Previous status: ${result.previousStatus}`);
      console.log(`Path: ${result.repository.localPath}`);
    });

  return repo;
}

function parseCommaSeparatedList(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseRepositoryStatus(
  value: string | undefined
): "active" | "archived" | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "active" || value === "archived") {
    return value;
  }

  throw new Error("--status must be active or archived");
}
