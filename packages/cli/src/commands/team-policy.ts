import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";

export function registerTeamPolicyCommand(program: Command): Command {
  const teamPolicy = program
    .command("team-policy")
    .description("Manage team policy overlays. Experimental.");

  teamPolicy
    .command("init")
    .description("Initialize the team policy source file.")
    .option("--cwd <path>", "Workspace directory")
    .option("--force", "Overwrite an existing team policy")
    .option("--actor <id>", "RBAC subject for team policy management", "local-admin")
    .action(async (options: { cwd?: string; force?: boolean; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "team_policy.manage",
        action: "manage team policy"
      });

      const { initTeamPolicy } = await import("../team-policy.js");
      const result = await initTeamPolicy({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.force === undefined ? {} : { force: options.force })
      });

      console.log(
        `${result.overwritten ? "Overwrote" : "Initialized"} team policy: ${result.path}`
      );
    });

  teamPolicy
    .command("show")
    .description("Show the team policy summary.")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for team policy access", "local-admin")
    .action(async (options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "team_policy.read",
        action: "inspect team policy"
      });

      const { formatTeamPolicySummary, loadTeamPolicy } =
        await import("../team-policy.js");
      const policy = await loadTeamPolicy({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      });

      console.log(formatTeamPolicySummary(policy));
    });

  teamPolicy
    .command("compile")
    .description("Compile the team policy into the Policy DSL.")
    .option("--cwd <path>", "Workspace directory")
    .option("--output <path>", "Compiled policy path")
    .option("--actor <id>", "RBAC subject for team policy management", "local-admin")
    .action(async (options: { cwd?: string; output?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "team_policy.manage",
        action: "manage team policy"
      });

      const { compileTeamPolicy } = await import("../team-policy.js");
      const result = await compileTeamPolicy({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.output === undefined ? {} : { output: options.output })
      });

      console.log(`Compiled team policy: ${result.outputPath}`);
      console.log(`Rules: ${result.policy.rules.length}`);
    });

  return teamPolicy;
}
