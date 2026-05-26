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

  return team;
}
