import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import {
  parseLocalAgentWorker,
  parsePositiveInteger,
  parseStartupGateStage
} from "../startup-command-parsers.js";
import {
  formatWorkerProcessProgress,
  type WorkerProcessProgress
} from "../wrapped-worker.js";

export function registerStartupRemediateCommand(startup: Command): Command {
  startup
    .command("remediate")
    .description(
      "Generate or execute worker-ready remediation tasks for startup gate blockers."
    )
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--stage <stage>",
      "Stage to remediate: idea, mvp, launch, or scale",
      "launch"
    )
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .option("--execute", "Create local agent tasks and run the remediation loop")
    .option(
      "--worker <worker>",
      "Worker for --execute: codex_direct, codex_cli, or claude_code",
      "codex_cli"
    )
    .option("--model <model>", "Model override for wrapped/direct worker execution")
    .option("--max-tasks <count>", "Maximum blockers to execute in this run")
    .option("--actor <id>", "RBAC subject for remediation task creation", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        stage: string;
        domain: string;
        execute?: boolean;
        worker: string;
        model?: string;
        maxTasks?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "task.run",
          action: "create startup remediation tasks"
        });

        const {
          executeStartupRemediationPlan,
          formatStartupRemediationExecution,
          formatStartupRemediationPlan,
          generateStartupRemediationPlan
        } = await import("../startup-remediation.js");
        const common = {
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          domain: options.domain,
          stage: parseStartupGateStage(options.stage)
        };

        if (options.execute === true) {
          const result = await executeStartupRemediationPlan({
            ...common,
            worker: parseLocalAgentWorker(options.worker),
            ...(options.model === undefined ? {} : { model: options.model }),
            ...(options.maxTasks === undefined
              ? {}
              : { maxTasks: parsePositiveInteger(options.maxTasks, "--max-tasks") }),
            onWorkerProgress: logWrappedWorkerProgress
          });

          console.log(formatStartupRemediationExecution(result));
          return;
        }

        const result = await generateStartupRemediationPlan(common);

        console.log(formatStartupRemediationPlan(result));
      }
    );

  return startup;
}

function logWrappedWorkerProgress(progress: WorkerProcessProgress): void {
  console.error(formatWorkerProcessProgress(progress));
}
