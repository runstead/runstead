import type { Command } from "commander";

import { registerStartupApiCommand } from "./commands/startup-api.js";
import { registerStartupAssessCommand } from "./commands/startup-assess.js";
import { registerStartupArtifactCommand } from "./commands/startup-artifact.js";
import { registerStartupCiCommand } from "./commands/startup-ci.js";
import { registerStartupCompleteCheckCommand } from "./commands/startup-complete-check.js";
import { registerStartupContextCommand } from "./commands/startup-context.js";
import { registerStartupEvidenceCommand } from "./commands/startup-evidence.js";
import { registerStartupFounderCommands } from "./commands/startup-founder.js";
import { registerStartupGateCommand } from "./commands/startup-gate.js";
import { registerStartupHypothesisCommand } from "./commands/startup-hypothesis.js";
import { registerStartupLaunchCommand } from "./commands/startup-launch.js";
import { registerStartupMeasurementCommand } from "./commands/startup-measurement.js";
import { registerStartupReadyCommand } from "./commands/startup-ready.js";
import { registerStartupRemediateCommand } from "./commands/startup-remediate.js";
import { registerStartupScaleCommand } from "./commands/startup-scale.js";
import { registerStartupSourceCommand } from "./commands/startup-source.js";
import { registerStartupTeamCommand } from "./commands/startup-team.js";
import { parseStartupInitStage } from "./startup-command-parsers.js";

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

  registerStartupCompleteCheckCommand(startup);

  registerStartupRemediateCommand(startup);

  registerStartupGateCommand(startup);
}
