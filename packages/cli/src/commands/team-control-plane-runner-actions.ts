export interface TeamControlPlaneRunnerHeartbeatCliOptions {
  cwd?: string;
  runnerId?: string;
  organizationId?: string;
  workspaceId?: string;
  labels?: string;
  status: string;
  schema: string;
  migrate?: boolean;
  json?: boolean;
}

export interface TeamControlPlaneRunnerListCliOptions {
  cwd?: string;
  organizationId?: string;
  workspaceId?: string;
  status?: string;
  schema: string;
  json?: boolean;
}

export async function recordTeamControlPlaneRunnerHeartbeatCommand(
  options: TeamControlPlaneRunnerHeartbeatCliOptions
): Promise<void> {
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
    ...(options.workspaceId === undefined ? {} : { workspaceId: options.workspaceId }),
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

export async function listTeamControlPlaneRunnersCommand(
  options: TeamControlPlaneRunnerListCliOptions
): Promise<void> {
  const { formatTeamControlPlaneRunnerList, listTeamControlPlaneRunners } =
    await import("../team-control-plane.js");
  const result = await listTeamControlPlaneRunners({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.organizationId === undefined
      ? {}
      : { organizationId: options.organizationId }),
    ...(options.workspaceId === undefined ? {} : { workspaceId: options.workspaceId }),
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
