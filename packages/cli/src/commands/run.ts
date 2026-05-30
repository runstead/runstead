import type { Command } from "commander";

import {
  collectValues,
  parseCiRepairWorkerKind,
  parseRequiredPositiveInteger
} from "../cli-parsers.js";
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
    .option("--plan", "Print the workflow plan without queuing or executing")
    .option("--max-tasks <count>", "Maximum workflow tasks to execute", (value) =>
      parseRequiredPositiveInteger(value, "--max-tasks")
    )
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

        if (options.plan === true) {
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
          return;
        }

        await runWorkPackWorkflow({ pack, workflow, options });
      }
    );
}

async function runWorkPackWorkflow(input: {
  pack: string;
  workflow: string;
  options: RunCommandOptions;
}): Promise<void> {
  await requireRbacPermission({
    ...(input.options.cwd === undefined ? {} : { cwd: input.options.cwd }),
    actor: input.options.actor,
    permission: "task.run",
    action: "run work-pack workflow"
  });

  const {
    executedWorkPackWorkflowRunExitCode,
    executeWorkPackWorkflowRun,
    formatExecutedWorkPackWorkflowRun
  } = await import("../work-pack-run.js");
  const result = await executeWorkPackWorkflowRun({
    pack: input.pack,
    workflow: input.workflow,
    ...(input.options.cwd === undefined ? {} : { cwd: input.options.cwd }),
    roots: input.options.root,
    includeBuiltIns: input.options.builtIns !== false,
    ...(input.options.maxTasks === undefined
      ? {}
      : { maxTasks: input.options.maxTasks }),
    ...(input.options.worker === undefined
      ? {}
      : { worker: parseCiRepairWorkerKind(input.options.worker) }),
    ...(input.options.provider === undefined
      ? {}
      : { provider: input.options.provider }),
    ...(input.options.model === undefined ? {} : { model: input.options.model }),
    ...(input.options.baseUrl === undefined ? {} : { baseUrl: input.options.baseUrl })
  });
  const exitCode = executedWorkPackWorkflowRunExitCode(result);

  console.log(formatExecutedWorkPackWorkflowRun(result));
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
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
  plan?: boolean;
  maxTasks?: number;
  worker?: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  actor: string;
}
