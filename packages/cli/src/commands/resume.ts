import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";

export function registerResumeCommand(program: Command): Command {
  return program
    .command("resume")
    .description("Resume interrupted local work by requeueing interrupted tasks.")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for task execution", "local-admin")
    .action(async (options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "task.run",
        action: "resume tasks"
      });

      const { resumeInterruptedTasks } = await import("../resume.js");
      const result = await resumeInterruptedTasks(options);

      console.log(`Requeued tasks: ${result.requeuedTasks.length}`);
      for (const item of result.requeuedTasks) {
        console.log(`${item.task.id}: ${item.previousStatus} -> ${item.task.status}`);
      }
      console.log(`Failed tasks: ${result.failedTasks.length}`);
      for (const item of result.failedTasks) {
        console.log(`${item.task.id}: ${item.previousStatus} -> ${item.task.status}`);
      }
    });
}
