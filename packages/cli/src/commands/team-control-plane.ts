import type { Command } from "commander";

import {
  bootstrapTeamControlPlaneCommand,
  checkTeamControlPlaneCommand,
  printTeamControlPlaneMigrationSqlCommand
} from "./team-control-plane-actions.js";
import { registerTeamControlPlaneRunnerCommand } from "./team-control-plane-runner.js";

export function registerTeamControlPlaneCommand(program: Command): Command {
  const team = program
    .command("team")
    .description("Inspect and bootstrap team control-plane runtime settings.");
  const controlPlane = team
    .command("control-plane")
    .description("Check or bootstrap shared team control-plane backend settings.");

  controlPlane
    .command("check")
    .description("Check whether the selected runtime backend is team-ready.")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--live",
      "Connect to the Postgres backend and read live runner heartbeat records"
    )
    .option("--migrate", "Apply Postgres control-plane migrations before live check")
    .option("--schema <name>", "Postgres schema name for live checks", "runstead")
    .option("--json", "Print the check result as JSON")
    .action(checkTeamControlPlaneCommand);

  controlPlane
    .command("bootstrap")
    .description("Write an example team control-plane environment template.")
    .option("--cwd <path>", "Workspace directory")
    .option("--output <path>", "Output env example path")
    .option("--force", "Overwrite an existing env example")
    .option(
      "--actor <id>",
      "RBAC subject for team control-plane bootstrap",
      "local-admin"
    )
    .action(bootstrapTeamControlPlaneCommand);

  controlPlane
    .command("migration-sql")
    .description("Print SQL for the Postgres team control-plane schema.")
    .option("--schema <name>", "Postgres schema name", "runstead")
    .action(printTeamControlPlaneMigrationSqlCommand);

  registerTeamControlPlaneRunnerCommand(controlPlane);

  return team;
}
