export interface TeamControlPlaneCheckCliOptions {
  cwd?: string;
  live?: boolean;
  migrate?: boolean;
  schema: string;
  json?: boolean;
}

export interface TeamControlPlaneBootstrapCliOptions {
  cwd?: string;
  output?: string;
  force?: boolean;
  actor: string;
}

export interface TeamControlPlaneMigrationSqlCliOptions {
  schema: string;
}

export async function checkTeamControlPlaneCommand(
  options: TeamControlPlaneCheckCliOptions
): Promise<void> {
  const { checkTeamControlPlane, formatTeamControlPlaneCheck } =
    await import("../team-control-plane.js");
  const result = await checkTeamControlPlane({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    live: options.live === true,
    liveMigrate: options.migrate === true,
    schema: options.schema
  });

  console.log(
    options.json === true
      ? `${JSON.stringify(result, null, 2)}`
      : formatTeamControlPlaneCheck(result)
  );
  if (!result.passed) {
    process.exitCode = 1;
  }
}

export async function bootstrapTeamControlPlaneCommand(
  options: TeamControlPlaneBootstrapCliOptions
): Promise<void> {
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

export async function printTeamControlPlaneMigrationSqlCommand(
  options: TeamControlPlaneMigrationSqlCliOptions
): Promise<void> {
  const { teamControlPlaneMigrationSql } = await import("../team-control-plane.js");

  console.log(teamControlPlaneMigrationSql({ schema: options.schema }));
}
