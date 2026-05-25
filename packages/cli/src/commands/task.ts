import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";

export function registerTaskCommand(program: Command): Command {
  const task = program.command("task").description("Manage durable tasks.");

  task
    .command("list")
    .description("List tasks.")
    .option("--cwd <path>", "Workspace directory")
    .option("--goal <id>", "Filter by goal id")
    .option("--actor <id>", "RBAC subject for task access", "local-admin")
    .action(async (options: { cwd?: string; goal?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "task.read",
        action: "list tasks"
      });

      const { listTasks } = await import("../tasks.js");
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
    .option("--actor <id>", "RBAC subject for task access", "local-admin")
    .action(async (id: string, options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "task.read",
        action: "inspect tasks"
      });

      const { showTask } = await import("../tasks.js");
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

  return task;
}
