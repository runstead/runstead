import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";

export function registerGoalCommand(program: Command): Command {
  const goal = program.command("goal").description("Manage durable goals.");

  goal
    .command("create")
    .description("Create a goal from a domain pack template.")
    .argument("[domain]", "Domain pack id", "repo-maintenance")
    .option("--cwd <path>", "Workspace directory")
    .option("--template <id>", "Goal template id")
    .option("--title <title>", "Override goal title")
    .option("--repo <ref>", "Registered repository id, alias, or path")
    .option("--actor <id>", "RBAC subject for goal management", "local-admin")
    .action(
      async (
        domain: string,
        options: {
          cwd?: string;
          template?: string;
          title?: string;
          repo?: string;
          actor: string;
        }
      ) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "goal.manage",
          action: "manage goals"
        });

        const { createGoal } = await import("../goals.js");
        const result = await createGoal({
          domain,
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.template === undefined ? {} : { template: options.template }),
          ...(options.title === undefined ? {} : { title: options.title }),
          ...(options.repo === undefined ? {} : { repository: options.repo })
        });

        console.log(`Created goal: ${result.goal.id} ${result.goal.title}`);
        for (const item of result.generatedTasks) {
          console.log(`Created task: ${item.id} ${item.type}`);
        }
      }
    );

  goal
    .command("list")
    .description("List goals.")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for goal access", "local-admin")
    .action(async (options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "goal.read",
        action: "list goals"
      });

      const { listGoals } = await import("../goals.js");
      const result = listGoals(options);

      if (result.goals.length === 0) {
        console.log("No goals found.");
        return;
      }

      for (const item of result.goals) {
        console.log(`${item.status.padEnd(9)} ${item.id} ${item.title}`);
      }
    });

  goal
    .command("show")
    .description("Show a goal.")
    .argument("<id>", "Goal id")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for goal access", "local-admin")
    .action(async (id: string, options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "goal.read",
        action: "inspect goals"
      });

      const { showGoal } = await import("../goals.js");
      const result = showGoal({ ...options, id });

      console.log(`Goal: ${result.goal.id}`);
      console.log(`Title: ${result.goal.title}`);
      console.log(`Domain: ${result.goal.domain}`);
      console.log(`Status: ${result.goal.status}`);
      console.log(`Priority: ${result.goal.priority}`);
      console.log(`Policy: ${result.goal.policyRef ?? "none"}`);
      console.log(`Scope: ${JSON.stringify(result.goal.scope)}`);
    });

  return goal;
}
