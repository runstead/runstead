import type { Command } from "commander";

import { buildDashboardCommand, serveDashboardCommand } from "./dashboard-actions.js";

export function registerDashboardCommand(program: Command): Command {
  const dashboard = program
    .command("dashboard")
    .description("Build dashboards. Experimental.");

  dashboard
    .command("build")
    .description("Build the local static dashboard.")
    .option("--cwd <path>", "Workspace directory")
    .option("--output <path>", "Dashboard output directory")
    .option("--actor <id>", "RBAC subject for dashboard generation", "local-admin")
    .action(buildDashboardCommand);

  dashboard
    .command("serve")
    .description("Build and serve the local dashboard over HTTP.")
    .option("--cwd <path>", "Workspace directory")
    .option("--output <path>", "Dashboard output directory")
    .option("--host <host>", "Host interface to bind", "127.0.0.1")
    .option("--port <port>", "Port to bind", "4173")
    .option("--actor <id>", "RBAC subject for dashboard generation", "local-admin")
    .option(
      "--enable-operator-api",
      "Enable protected local mutating Operator Console endpoints"
    )
    .option("--operator-token <token>", "Operator API session token")
    .option("--csrf-token <token>", "Operator API CSRF token")
    .action(serveDashboardCommand);

  return dashboard;
}
