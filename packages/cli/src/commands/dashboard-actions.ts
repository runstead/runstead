export interface DashboardBuildCliOptions {
  cwd?: string;
  output?: string;
  actor: string;
}

export interface DashboardServeCliOptions {
  cwd?: string;
  output?: string;
  host: string;
  port: string;
  actor: string;
  enableOperatorApi?: boolean;
  operatorToken?: string;
  csrfToken?: string;
}

export async function buildDashboardCommand(
  options: DashboardBuildCliOptions
): Promise<void> {
  const { checkPermission } = await import("../rbac.js");
  const permission = await checkPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    subject: options.actor,
    permission: "dashboard.manage"
  });

  if (permission.decision !== "allow") {
    throw new Error(
      `Subject ${options.actor} cannot build dashboard: ${permission.reason}`
    );
  }

  const { buildDashboard } = await import("../dashboard.js");
  const result = await buildDashboard({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.output === undefined ? {} : { outputDir: options.output })
  });

  console.log(`Dashboard HTML: ${result.htmlPath}`);
  console.log(`Dashboard data: ${result.dataPath}`);
}

export async function serveDashboardCommand(
  options: DashboardServeCliOptions
): Promise<void> {
  const { checkPermission } = await import("../rbac.js");
  const permission = await checkPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    subject: options.actor,
    permission: "dashboard.manage"
  });

  if (permission.decision !== "allow") {
    throw new Error(
      `Subject ${options.actor} cannot serve dashboard: ${permission.reason}`
    );
  }

  const { serveDashboard } = await import("../dashboard.js");
  const result = await serveDashboard({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.output === undefined ? {} : { outputDir: options.output }),
    host: options.host,
    port: parseDashboardPort(options.port),
    enableOperatorApi: options.enableOperatorApi === true,
    ...(options.operatorToken === undefined
      ? {}
      : { sessionToken: options.operatorToken }),
    ...(options.csrfToken === undefined ? {} : { csrfToken: options.csrfToken }),
    actor: options.actor
  });

  console.log(`Dashboard URL: ${result.url}`);
  console.log(`Dashboard HTML: ${result.build.htmlPath}`);
  console.log(`Dashboard data: ${result.build.dataPath}`);
  if (result.operatorApi !== undefined) {
    console.log("Operator API: enabled");
    console.log(`Operator API session token: ${result.operatorApi.sessionToken}`);
    console.log(`Operator API CSRF token: ${result.operatorApi.csrfToken}`);
  }
}

function parseDashboardPort(value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed)) {
    throw new Error("--port must be an integer");
  }

  if (parsed < 0 || parsed > 65_535) {
    throw new Error("--port must be between 0 and 65535");
  }

  return parsed;
}
