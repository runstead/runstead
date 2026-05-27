import type { Command } from "commander";

import {
  listTeamControlPlaneRunnersCommand,
  recordTeamControlPlaneRunnerHeartbeatCommand
} from "./team-control-plane-runner-actions.js";

export function registerTeamControlPlaneRunnerCommand(controlPlane: Command): Command {
  const runner = controlPlane
    .command("runner")
    .description("Record and inspect Postgres-backed team runner heartbeats.");

  runner
    .command("heartbeat")
    .description("Record a live runner heartbeat in the Postgres team backend.")
    .option("--cwd <path>", "Workspace directory")
    .option("--runner-id <id>", "Runner id. Defaults to RUNSTEAD_RUNNER_ID.")
    .option("--organization-id <id>", "Organization id")
    .option("--workspace-id <id>", "Workspace id")
    .option("--labels <labels>", "Comma-separated runner labels")
    .option(
      "--status <status>",
      "Runner status: active, draining, or offline",
      "active"
    )
    .option("--schema <name>", "Postgres schema name", "runstead")
    .option("--migrate", "Apply Postgres control-plane migrations first")
    .option("--json", "Print the heartbeat result as JSON")
    .action(recordTeamControlPlaneRunnerHeartbeatCommand);

  runner
    .command("list")
    .description("List runners recorded in the Postgres team backend.")
    .option("--cwd <path>", "Workspace directory")
    .option("--organization-id <id>", "Organization id")
    .option("--workspace-id <id>", "Workspace id")
    .option("--status <status>", "Filter by status: active, draining, or offline")
    .option("--schema <name>", "Postgres schema name", "runstead")
    .option("--json", "Print the runner list as JSON")
    .action(listTeamControlPlaneRunnersCommand);

  return runner;
}
