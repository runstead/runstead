import type { Command } from "commander";

import { parseDateOption, parseRequiredInteger } from "../cli-parsers.js";

export function registerSchedulerCommand(program: Command): Command {
  const scheduler = program
    .command("scheduler")
    .description("Manage background scheduling.");

  scheduler
    .command("tick")
    .description("Schedule due recurring tasks once.")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--interval-ms <number>",
      "Default recurrence interval for goals without scheduler metadata",
      "86400000"
    )
    .option("--now <iso>", "Override the current timestamp")
    .option("--actor <id>", "RBAC subject for scheduler management", "local-admin")
    .action(async (options: SchedulerTickOptions) => {
      const { checkPermission } = await import("../rbac.js");
      const permission = await checkPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        subject: options.actor,
        permission: "daemon.manage"
      });

      if (permission.decision !== "allow") {
        throw new Error(
          `Subject ${options.actor} cannot manage scheduler: ${permission.reason}`
        );
      }

      const { formatSchedulerReport, scheduleDueTasks } =
        await import("../scheduler.js");
      const result = await scheduleDueTasks({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        defaultIntervalMs: parseRequiredInteger(options.intervalMs, "--interval-ms"),
        ...(options.now === undefined
          ? {}
          : { now: parseDateOption(options.now, "--now") })
      });

      console.log(formatSchedulerReport(result));
    });

  return scheduler;
}

interface SchedulerTickOptions {
  cwd?: string;
  intervalMs: string;
  now?: string;
  actor: string;
}
