import type { Command } from "commander";

import { parseOptionalInteger, parseRequiredInteger } from "../cli-parsers.js";

export function registerDaemonCommand(program: Command): Command {
  return program
    .command("daemon")
    .description("Run the local Runstead daemon loop.")
    .option("--cwd <path>", "Workspace directory")
    .option("--once", "Run one daemon tick and exit")
    .option("--status", "Print the last daemon heartbeat and exit")
    .option("--max-ticks <number>", "Stop after this many ticks")
    .option("--interval-ms <number>", "Delay between ticks", "30000")
    .option("--no-scheduler", "Disable background scheduling before each tick")
    .option("--no-heartbeat", "Disable daemon heartbeat status writes")
    .option("--actor <id>", "RBAC subject for daemon management", "local-admin")
    .action(async (options: DaemonCommandOptions) => {
      const { checkPermission } = await import("../rbac.js");
      const permission = await checkPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        subject: options.actor,
        permission: "daemon.manage"
      });

      if (permission.decision !== "allow") {
        throw new Error(
          `Subject ${options.actor} cannot manage daemon: ${permission.reason}`
        );
      }

      const { formatDaemonReport, formatDaemonStatus, readDaemonStatus, runDaemon } =
        await import("../daemon.js");

      if (options.status === true) {
        const status = await readDaemonStatus({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          staleAfterMs: parseRequiredInteger(options.intervalMs, "--interval-ms") * 2
        });
        console.log(formatDaemonStatus(status));
        return;
      }

      const maxTicks =
        options.once === true
          ? 1
          : parseOptionalInteger(options.maxTicks, "--max-ticks");
      const intervalMs = parseRequiredInteger(options.intervalMs, "--interval-ms");
      const result = await runDaemon({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(maxTicks === undefined ? {} : { maxTicks }),
        intervalMs,
        schedulerEnabled: options.scheduler !== false,
        heartbeat: options.heartbeat !== false
      });

      console.log(formatDaemonReport(result));
    });
}

interface DaemonCommandOptions {
  cwd?: string;
  once?: boolean;
  status?: boolean;
  maxTicks?: string;
  intervalMs: string;
  scheduler?: boolean;
  heartbeat?: boolean;
  actor: string;
}
