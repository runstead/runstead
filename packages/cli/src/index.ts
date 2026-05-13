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

  program
    .command("resume")
    .description("Resume interrupted local work by requeueing interrupted tasks.")
    .option("--cwd <path>", "Workspace directory")
    .action(async (options: { cwd?: string }) => {
      const { resumeInterruptedTasks } = await import("./resume.js");
      const result = resumeInterruptedTasks(options);

      console.log(`Requeued tasks: ${result.requeuedTasks.length}`);
      for (const item of result.requeuedTasks) {
        console.log(`${item.task.id}: ${item.previousStatus} -> ${item.task.status}`);
      }
      console.log(`Failed tasks: ${result.failedTasks.length}`);
      for (const item of result.failedTasks) {
        console.log(`${item.task.id}: ${item.previousStatus} -> ${item.task.status}`);
      }
    });

  program
    .command("run")
    .description("Run local work.")
    .option("--once", "Run at most one task")
    .option("--cwd <path>", "Workspace directory")
    .action(async (options: { once?: boolean; cwd?: string }) => {
      if (options.once !== true) {
        throw new Error("Only --once is supported in v0.0.1");
      }

      const { runOnce } = await import("./run.js");
      const result = await runOnce(options);

      if (!result.ranTask) {
        console.log("No queued task was found.");
        return;
      }

      console.log(`Ran task: ${result.task.id} ${result.task.type}`);
      console.log(`Status: ${result.task.status}`);
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
        for (const item of result.generatedTasks) {
          console.log(`Created task: ${item.id} ${item.type}`);
        }
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

  const task = program.command("task").description("Manage durable tasks.");

  task
    .command("list")
    .description("List tasks.")
    .option("--cwd <path>", "Workspace directory")
    .option("--goal <id>", "Filter by goal id")
    .action(async (options: { cwd?: string; goal?: string }) => {
      const { listTasks } = await import("./tasks.js");
      const result = listTasks({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.goal === undefined ? {} : { goalId: options.goal })
      });

      if (result.tasks.length === 0) {
        console.log("No tasks found.");
        return;
      }

      for (const item of result.tasks) {
        console.log(
          `${item.status.padEnd(9)} ${item.id} ${item.type} (${item.goalId})`
        );
      }
    });

  task
    .command("show")
    .description("Show a task.")
    .argument("<id>", "Task id")
    .option("--cwd <path>", "Workspace directory")
    .action(async (id: string, options: { cwd?: string }) => {
      const { showTask } = await import("./tasks.js");
      const result = showTask({ ...options, id });

      console.log(`Task: ${result.task.id}`);
      console.log(`Goal: ${result.task.goalId}`);
      console.log(`Domain: ${result.task.domain}`);
      console.log(`Type: ${result.task.type}`);
      console.log(`Status: ${result.task.status}`);
      console.log(`Priority: ${result.task.priority}`);
      console.log(`Attempt: ${result.task.attempt}/${result.task.maxAttempts}`);
      console.log(`Input: ${JSON.stringify(result.task.input)}`);
      console.log(`Verifiers: ${result.task.verifiers.join(", ")}`);
    });

  const verifier = program.command("verifier").description("Run verifiers.");

  verifier
    .command("run")
    .description("Run verifier commands for a task.")
    .argument("<task-id>", "Task id")
    .option("--cwd <path>", "Workspace directory")
    .option("--timeout-ms <ms>", "Per-command timeout in milliseconds")
    .action(async (taskId: string, options: { cwd?: string; timeoutMs?: string }) => {
      const { runTaskVerifiers } = await import("./verifier-runner.js");
      const timeoutMs =
        options.timeoutMs === undefined
          ? undefined
          : Number.parseInt(options.timeoutMs, 10);

      if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
        throw new Error("--timeout-ms must be a positive integer");
      }

      const result = await runTaskVerifiers({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        taskId,
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });

      console.log(`Task: ${result.task.id}`);
      console.log(`Status: ${result.task.status}`);
      for (const command of result.commandResults) {
        console.log(
          `${command.verifier}: exit=${command.exitCode ?? "unknown"} evidence=${command.evidenceId}`
        );
      }
    });

  return program;
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;

if (entrypoint === import.meta.url) {
  await createProgram().parseAsync(process.argv);
}
