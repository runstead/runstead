import type { Command } from "commander";

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
    .action(
      async (options: {
        cwd?: string;
        runnerId?: string;
        organizationId?: string;
        workspaceId?: string;
        labels?: string;
        status: string;
        schema: string;
        migrate?: boolean;
        json?: boolean;
      }) => {
        const {
          formatTeamControlPlaneRunnerHeartbeat,
          recordTeamControlPlaneRunnerHeartbeat
        } = await import("../team-control-plane.js");
        const result = await recordTeamControlPlaneRunnerHeartbeat({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.runnerId === undefined ? {} : { runnerId: options.runnerId }),
          ...(options.organizationId === undefined
            ? {}
            : { organizationId: options.organizationId }),
          ...(options.workspaceId === undefined
            ? {}
            : { workspaceId: options.workspaceId }),
          labels: splitCommaList(options.labels),
          status: parseRunnerStatus(options.status),
          schema: options.schema,
          migrate: options.migrate === true
        });

        console.log(
          options.json === true
            ? `${JSON.stringify(result, null, 2)}`
            : formatTeamControlPlaneRunnerHeartbeat(result)
        );
      }
    );

  runner
    .command("list")
    .description("List runners recorded in the Postgres team backend.")
    .option("--cwd <path>", "Workspace directory")
    .option("--organization-id <id>", "Organization id")
    .option("--workspace-id <id>", "Workspace id")
    .option("--status <status>", "Filter by status: active, draining, or offline")
    .option("--schema <name>", "Postgres schema name", "runstead")
    .option("--json", "Print the runner list as JSON")
    .action(
      async (options: {
        cwd?: string;
        organizationId?: string;
        workspaceId?: string;
        status?: string;
        schema: string;
        json?: boolean;
      }) => {
        const { formatTeamControlPlaneRunnerList, listTeamControlPlaneRunners } =
          await import("../team-control-plane.js");
        const result = await listTeamControlPlaneRunners({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.organizationId === undefined
            ? {}
            : { organizationId: options.organizationId }),
          ...(options.workspaceId === undefined
            ? {}
            : { workspaceId: options.workspaceId }),
          ...(options.status === undefined
            ? {}
            : { status: parseRunnerStatus(options.status) }),
          schema: options.schema
        });

        console.log(
          options.json === true
            ? `${JSON.stringify(result, null, 2)}`
            : formatTeamControlPlaneRunnerList(result)
        );
      }
    );

  return runner;
}

function splitCommaList(value: string | undefined): string[] {
  return (
    value
      ?.split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0) ?? []
  );
}

function parseRunnerStatus(value: string): "active" | "draining" | "offline" {
  if (value === "active" || value === "draining" || value === "offline") {
    return value;
  }

  throw new Error(`Runner status must be active, draining, or offline, got ${value}`);
}
