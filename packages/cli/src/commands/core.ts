import type { Command } from "commander";

export function registerCoreCommands(program: Command): void {
  registerInitCommand(program);
  registerStatusCommand(program);
  registerUpgradeCommand(program);
}

function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize .runstead state and the repo-maintenance domain pack.")
    .option("--cwd <path>", "Workspace directory")
    .option("--force", "Overwrite generated config files")
    .option(
      "--profile <profile>",
      "Policy profile to generate: default or trusted-local",
      "default"
    )
    .option("--create-default-goal", "Create the default repo-maintenance goal")
    .action(
      async (options: {
        cwd?: string;
        force?: boolean;
        profile?: "default" | "trusted-local";
        createDefaultGoal?: boolean;
      }) => {
        const { initRunstead } = await import("../init.js");
        const result = await initRunstead(options);

        console.log(`Initialized ${result.root}`);
        console.log(`Installed domain pack: ${result.domain}`);
        console.log(`Policy profile: ${result.profile}`);
        console.log(`Created SQLite state: ${result.stateDb}`);
        if (result.defaultGoal !== undefined) {
          console.log(
            `Created goal: ${result.defaultGoal.id} ${result.defaultGoal.title}`
          );
          for (const task of result.generatedTasks) {
            console.log(`Created task: ${task.id} ${task.type}`);
          }
        }
      }
    );
}

function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show local Runstead initialization status.")
    .option("--cwd <path>", "Workspace directory")
    .action(async (options: { cwd?: string }) => {
      const { getRunsteadStatus } = await import("../status.js");
      const status = await getRunsteadStatus(options.cwd);

      if (!status.initialized) {
        console.log(`Runstead is not initialized at ${status.root}`);
        return;
      }

      console.log(`Runstead initialized at ${status.root}`);
      console.log(`Domain: ${status.domain ?? "unknown"}`);

      const goals = status.goals ?? [];
      if (goals.length === 0) {
        console.log("Goals: none");
      } else {
        console.log("Goals:");
        for (const goal of goals) {
          console.log(`  ${goal.status.padEnd(9)} ${goal.id} ${goal.title}`);
        }
      }

      const taskCounts = status.tasks?.byStatus ?? {};
      const taskStatuses = Object.keys(taskCounts);
      if (taskStatuses.length === 0) {
        console.log("Tasks: none");
      } else {
        console.log("Tasks:");
        for (const taskStatus of taskStatuses) {
          console.log(`  ${taskStatus.padEnd(9)} ${taskCounts[taskStatus]}`);
        }
      }

      if (status.latestEvidence !== undefined) {
        console.log(
          `Latest evidence: ${status.latestEvidence.id} ${status.latestEvidence.type}`
        );
      }
    });
}

function registerUpgradeCommand(program: Command): void {
  program
    .command("upgrade")
    .description("Apply missing scaffold defaults to an existing .runstead state.")
    .option("--cwd <path>", "Workspace directory")
    .action(async (options: { cwd?: string }) => {
      const { formatUpgradeRunsteadReport, upgradeRunsteadState } =
        await import("../upgrade.js");
      const result = await upgradeRunsteadState(options);

      console.log(formatUpgradeRunsteadReport(result));
    });
}
