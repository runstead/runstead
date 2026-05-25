import type { Command } from "commander";

import { registerStartupApiCommand } from "./commands/startup-api.js";
import { registerStartupAssessCommand } from "./commands/startup-assess.js";
import { registerStartupArtifactCommand } from "./commands/startup-artifact.js";
import { registerStartupCiCommand } from "./commands/startup-ci.js";
import { registerStartupContextCommand } from "./commands/startup-context.js";
import { registerStartupEvidenceCommand } from "./commands/startup-evidence.js";
import { registerStartupFounderCommands } from "./commands/startup-founder.js";
import { registerStartupGateCommand } from "./commands/startup-gate.js";
import { registerStartupHypothesisCommand } from "./commands/startup-hypothesis.js";
import { registerStartupLaunchCommand } from "./commands/startup-launch.js";
import { registerStartupMeasurementCommand } from "./commands/startup-measurement.js";
import { registerStartupReadyCommand } from "./commands/startup-ready.js";
import { registerStartupScaleCommand } from "./commands/startup-scale.js";
import { registerStartupSourceCommand } from "./commands/startup-source.js";
import { registerStartupTeamCommand } from "./commands/startup-team.js";
import { checkPermission } from "./rbac.js";
import {
  parseLocalAgentWorker,
  parsePositiveInteger,
  parseStartupGateStage,
  parseStartupInitStage
} from "./startup-command-parsers.js";
import {
  formatWorkerProcessProgress,
  type WorkerProcessProgress
} from "./wrapped-worker.js";

export function registerStartupCommands(program: Command): void {
  const startup = program
    .command("startup")
    .description("Manage AI-native startup evidence and stage gates.");

  startup
    .command("init")
    .description("Initialize AI-native startup execution for a workspace.")
    .option("--cwd <path>", "Workspace directory")
    .option("--stage <stage>", "Startup stage: mvp, launch, or scale", "mvp")
    .option(
      "--profile <profile>",
      "Policy profile to generate when Runstead is not initialized: default or trusted-local",
      "default"
    )
    .option("--force", "Upgrade installed startup pack and create a fresh startup goal")
    .action(
      async (options: {
        cwd?: string;
        stage: string;
        profile: "default" | "trusted-local";
        force?: boolean;
      }) => {
        const { initStartup } = await import("./startup-automation.js");
        const result = await initStartup({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          stage: parseStartupInitStage(options.stage),
          profile: options.profile,
          force: options.force === true
        });

        console.log(`Initialized startup execution: ${result.root}`);
        console.log(`Stage: ${result.stage}`);
        console.log(`Installed startup domain: ${result.domainInstalled}`);
        console.log(`Upgraded startup domain: ${result.domainUpgraded}`);
        console.log(
          `${result.goalCreated ? "Created" : "Reused"} goal: ${result.goal.id} ${result.goal.title}`
        );
        for (const task of result.generatedTasks) {
          console.log(`Created task: ${task.id} ${task.type}`);
        }
      }
    );

  startup
    .command("status")
    .description(
      "Show the founder startup stage, gate blockers, evidence freshness, and next action."
    )
    .option("--cwd <path>", "Workspace directory")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .action(async (options: { cwd?: string; domain: string }) => {
      const { formatStartupStatus, getStartupStatus } =
        await import("./startup-status.js");
      const result = await getStartupStatus({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        domain: options.domain
      });

      console.log(formatStartupStatus(result));
    });

  registerStartupApiCommand(startup);

  registerStartupAssessCommand(startup);

  registerStartupReadyCommand(startup);

  registerStartupFounderCommands(startup);

  registerStartupCiCommand(startup);

  registerStartupContextCommand(startup);

  registerStartupMeasurementCommand(startup);

  registerStartupSourceCommand(startup);

  registerStartupLaunchCommand(startup);

  registerStartupScaleCommand(startup);

  registerStartupTeamCommand(startup);

  registerStartupHypothesisCommand(startup);

  registerStartupEvidenceCommand(startup);

  registerStartupArtifactCommand(startup);

  startup
    .command("complete-check")
    .description(
      "Run the minimal complete product audit across launch report, CI gate, dashboard, diagnostics, remediation, evidence, and events."
    )
    .option("--cwd <path>", "Workspace directory")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .option(
      "--target <target>",
      "Launch target: local, staging, or production",
      "local"
    )
    .option("--print", "Print the generated markdown")
    .option("--actor <id>", "RBAC subject for complete product audit", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        domain: string;
        target: string;
        print?: boolean;
        actor: string;
      }) => {
        const common = {
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor
        };

        await requireRbacPermission({
          ...common,
          permission: "evidence.write",
          action: "write startup complete product audit evidence"
        });
        await requireRbacPermission({
          ...common,
          permission: "audit.read",
          action: "read startup complete product audit inputs"
        });
        await requireRbacPermission({
          ...common,
          permission: "dashboard.manage",
          action: "build startup complete product dashboard surface"
        });
        await requireRbacPermission({
          ...common,
          permission: "task.run",
          action: "plan startup complete product remediation"
        });

        const {
          formatStartupCompleteProductCheck,
          generateStartupCompleteProductCheck
        } = await import("./startup-complete-check.js");
        const { parseStartupReadyTarget } = await import("./startup-ready.js");
        const result = await generateStartupCompleteProductCheck({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          domain: options.domain,
          target: parseStartupReadyTarget(options.target)
        });

        console.log(`Generated startup complete product check: ${result.markdownPath}`);
        console.log(`JSON: ${result.jsonPath}`);
        console.log(`Status: ${result.status}`);
        console.log(`Score: ${Math.round(result.score * 100)}%`);
        console.log(`Evidence: ${result.evidenceId}`);
        console.log(`Event: ${result.event.eventId}`);

        if (options.print === true) {
          console.log("");
          console.log(formatStartupCompleteProductCheck(result));
        }

        if (result.status !== "complete") {
          process.exitCode = 1;
        }
      }
    );

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
        } = await import("./startup-remediation.js");
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

  registerStartupGateCommand(startup);
}

async function requireRbacPermission(options: {
  cwd?: string;
  actor: string;
  permission: string;
  action: string;
}): Promise<void> {
  const result = await checkPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    subject: options.actor,
    permission: options.permission
  });

  if (result.decision !== "allow") {
    throw new Error(
      `Subject ${options.actor} cannot ${options.action}: ${result.reason}`
    );
  }
}

function logWrappedWorkerProgress(progress: WorkerProcessProgress): void {
  console.error(formatWorkerProcessProgress(progress));
}
