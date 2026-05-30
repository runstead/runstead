import type { Command } from "commander";

import { collectValues, parseCiRepairWorkerKind } from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";

export function registerRunCommand(program: Command): Command {
  return program
    .command("run")
    .description("Run local work.")
    .argument("[pack]", "Work pack id or domain pack path")
    .argument("[workflow]", "Workflow id declared by the pack")
    .option("--once", "Run at most one task")
    .option("--cwd <path>", "Workspace directory")
    .option("--root <path>", "Additional domain pack root", collectValues, [])
    .option("--no-built-ins", "Exclude built-in domain packs")
    .option("--worker <worker>", "Worker override for queued CI repair tasks")
    .option("--provider <provider>", "Model provider override for queued agent tasks")
    .option("--model <model>", "Model override for queued agent tasks")
    .option("--base-url <url>", "Model provider base URL override")
    .option("--actor <id>", "RBAC subject for task execution", "local-admin")
    .action(
      async (
        pack: string | undefined,
        workflow: string | undefined,
        options: RunCommandOptions
      ) => {
        if (options.once === true) {
          if (pack !== undefined || workflow !== undefined) {
            throw new Error("--once cannot be combined with <pack> <workflow>");
          }

          await runQueuedTaskOnce(options);
          return;
        }

        if (pack === undefined || workflow === undefined) {
          throw new Error(
            "Expected runstead run <pack> <workflow> or runstead run --once"
          );
        }

        const { formatWorkPackWorkflowRunPlan, resolveWorkPackWorkflowRun } =
          await import("../work-pack-run.js");
        const result = await resolveWorkPackWorkflowRun({
          pack,
          workflow,
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          roots: options.root,
          includeBuiltIns: options.builtIns !== false
        });

        console.log(formatWorkPackWorkflowRunPlan(result));
      }
    );
}

async function runQueuedTaskOnce(options: RunCommandOptions): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "task.run",
    action: "run tasks"
  });

  const { formatRunOnceReport, runOnce, runOnceExitCode } = await import("../run.js");
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
}

interface RunCommandOptions {
  once?: boolean;
  cwd?: string;
  root: string[];
  builtIns?: boolean;
  worker?: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  actor: string;
}
