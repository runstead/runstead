import type { Command } from "commander";

import { parseCiRepairWorkerKind } from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";

export function registerRunCommand(program: Command): Command {
  return program
    .command("run")
    .description("Run local work.")
    .option("--once", "Run at most one task")
    .option("--cwd <path>", "Workspace directory")
    .option("--worker <worker>", "Worker override for queued CI repair tasks")
    .option("--provider <provider>", "Model provider override for queued agent tasks")
    .option("--model <model>", "Model override for queued agent tasks")
    .option("--base-url <url>", "Model provider base URL override")
    .option("--actor <id>", "RBAC subject for task execution", "local-admin")
    .action(async (options: RunCommandOptions) => {
      if (options.once !== true) {
        throw new Error("Only --once is supported in v0.0.1");
      }

      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "task.run",
        action: "run tasks"
      });

      const { formatRunOnceReport, runOnce, runOnceExitCode } =
        await import("../run.js");
      const result = await runOnce({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.worker === undefined
          ? {}
          : { worker: parseCiRepairWorkerKind(options.worker) }),
        ...(options.provider === undefined ? {} : { provider: options.provider }),
        ...(options.model === undefined ? {} : { model: options.model }),
        ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl })
      });
      const exitCode = runOnceExitCode(result);

      console.log(formatRunOnceReport(result));
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
}

interface RunCommandOptions {
  once?: boolean;
  cwd?: string;
  worker?: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  actor: string;
}
