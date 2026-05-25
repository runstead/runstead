import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import { requireUnmanagedHelperAcknowledgement } from "../cli-unmanaged.js";

export function registerGitCommand(program: Command): Command {
  const git = program.command("git").description("Git helpers for repo maintenance.");
  const gitBranch = git.command("branch").description("Manage Runstead git branches.");

  gitBranch
    .command("create")
    .description(
      "Create a git branch without overwriting existing branches. Unmanaged helper; governed branch creation runs through CI repair."
    )
    .argument("<branch-name>", "Branch name")
    .option("--cwd <path>", "Workspace directory")
    .option("--base <ref>", "Base ref")
    .option("--actor <id>", "RBAC subject for git branch management", "local-admin")
    .option("--unmanaged", "Acknowledge this helper bypasses governed runtime")
    .action(
      async (
        branchName: string,
        options: {
          cwd?: string;
          base?: string;
          actor: string;
          unmanaged?: boolean;
        }
      ) => {
        requireUnmanagedHelperAcknowledgement(options, "manage git branches");
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "repo.manage",
          action: "manage git branches"
        });

        const { createGitBranch } = await import("../git-branch.js");
        const result = await createGitBranch({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          branchName,
          ...(options.base === undefined ? {} : { baseRef: options.base })
        });

        console.log(`Created branch: ${result.branchName}`);
      }
    );

  return git;
}
