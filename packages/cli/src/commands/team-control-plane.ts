import type { Command } from "commander";

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
    .option("--json", "Print the check result as JSON")
    .action(async (options: { cwd?: string; json?: boolean }) => {
      const { checkTeamControlPlane, formatTeamControlPlaneCheck } =
        await import("../team-control-plane.js");
      const result = await checkTeamControlPlane({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      });

      console.log(
        options.json === true
          ? `${JSON.stringify(result, null, 2)}`
          : formatTeamControlPlaneCheck(result)
      );
      if (!result.passed) {
        process.exitCode = 1;
      }
    });

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
    .action(
      async (options: {
        cwd?: string;
        output?: string;
        force?: boolean;
        actor: string;
      }) => {
        const { checkPermission } = await import("../rbac.js");
        const permission = await checkPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          subject: options.actor,
          permission: "team_policy.manage"
        });

        if (permission.decision !== "allow") {
          throw new Error(
            `Subject ${options.actor} cannot bootstrap team control plane: ${permission.reason}`
          );
        }

        const { bootstrapTeamControlPlane } = await import("../team-control-plane.js");
        const result = await bootstrapTeamControlPlane({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.output === undefined ? {} : { output: options.output }),
          ...(options.force === undefined ? {} : { force: options.force })
        });

        console.log(
          `${result.overwritten ? "Overwrote" : "Wrote"} team control-plane env template: ${result.path}`
        );
        console.log(`Check command: ${result.checkCommand}`);
      }
    );

  controlPlane
    .command("migration-sql")
    .description("Print SQL for the Postgres team control-plane schema.")
    .option("--schema <name>", "Postgres schema name", "runstead")
    .action(async (options: { schema: string }) => {
      const { teamControlPlaneMigrationSql } = await import("../team-control-plane.js");

      console.log(teamControlPlaneMigrationSql({ schema: options.schema }));
    });

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

  return team;
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
