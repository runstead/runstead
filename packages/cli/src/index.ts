#!/usr/bin/env node
import { Command } from "commander";
import { pathToFileURL } from "node:url";

import { getRunsteadStatus } from "./status.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("runstead")
    .description("Control plane for long-running autonomous work agents.")
    .version("0.0.0");

  program
    .command("init")
    .description("Initialize .runstead state and the repo-maintenance domain pack.")
    .option("--cwd <path>", "Workspace directory")
    .option("--force", "Overwrite generated config files")
    .action(async (options: { cwd?: string; force?: boolean }) => {
      const { initRunstead } = await import("./init.js");
      const result = await initRunstead(options);

      console.log(`Initialized ${result.root}`);
      console.log(`Installed domain pack: ${result.domain}`);
      console.log(`Created SQLite state: ${result.stateDb}`);
    });

  program
    .command("status")
    .description("Show local Runstead initialization status.")
    .option("--cwd <path>", "Workspace directory")
    .action(async (options: { cwd?: string }) => {
      const status = await getRunsteadStatus(options.cwd);

      if (!status.initialized) {
        console.log(`Runstead is not initialized at ${status.root}`);
        return;
      }

      console.log(`Runstead initialized at ${status.root}`);
      console.log(`Domain: ${status.domain ?? "unknown"}`);
    });

  program
    .command("doctor")
    .description("Check local Runstead state and scaffold health.")
    .option("--cwd <path>", "Workspace directory")
    .action(async (options: { cwd?: string }) => {
      const { doctorRunstead } = await import("./doctor.js");
      const result = await doctorRunstead(options);

      console.log(`Runstead doctor for ${result.root}`);

      for (const check of result.checks) {
        console.log(`[${check.status}] ${check.label}: ${check.message}`);
      }

      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  const goal = program.command("goal").description("Manage durable goals.");

  goal
    .command("create")
    .description("Create a goal from a domain pack template.")
    .argument("[domain]", "Domain pack id", "repo-maintenance")
    .option("--cwd <path>", "Workspace directory")
    .option("--template <id>", "Goal template id")
    .option("--title <title>", "Override goal title")
    .action(
      async (
        domain: string,
        options: { cwd?: string; template?: string; title?: string }
      ) => {
        const { createGoal } = await import("./goals.js");
        const result = await createGoal({ ...options, domain });

        console.log(`Created goal: ${result.goal.id} ${result.goal.title}`);
      }
    );

  goal
    .command("list")
    .description("List goals.")
    .option("--cwd <path>", "Workspace directory")
    .action(async (options: { cwd?: string }) => {
      const { listGoals } = await import("./goals.js");
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
    .action(async (id: string, options: { cwd?: string }) => {
      const { showGoal } = await import("./goals.js");
      const result = showGoal({ ...options, id });

      console.log(`Goal: ${result.goal.id}`);
      console.log(`Title: ${result.goal.title}`);
      console.log(`Domain: ${result.goal.domain}`);
      console.log(`Status: ${result.goal.status}`);
      console.log(`Priority: ${result.goal.priority}`);
      console.log(`Policy: ${result.goal.policyRef ?? "none"}`);
      console.log(`Scope: ${JSON.stringify(result.goal.scope)}`);
    });

  return program;
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;

if (entrypoint === import.meta.url) {
  await createProgram().parseAsync(process.argv);
}
