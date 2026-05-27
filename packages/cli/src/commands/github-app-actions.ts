export interface GitHubAppInitCommandOptions {
  cwd?: string;
  appId: string;
  privateKey: string;
  installationId?: string;
  apiBaseUrl?: string;
  force?: boolean;
  actor: string;
}

export interface GitHubAppStatusCommandOptions {
  cwd?: string;
  actor: string;
}

export {
  runGitHubAppJwtCommand,
  runGitHubAppTokenCommand
} from "./github-app-secret-actions.js";
export type {
  GitHubAppJwtCommandOptions,
  GitHubAppTokenCommandOptions
} from "./github-app-secret-actions.js";

export async function runGitHubAppInitCommand(
  options: GitHubAppInitCommandOptions
): Promise<void> {
  const { checkPermission } = await import("../rbac.js");
  const permission = await checkPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    subject: options.actor,
    permission: "github_app.manage"
  });

  if (permission.decision !== "allow") {
    throw new Error(
      `Subject ${options.actor} cannot manage GitHub App mode: ${permission.reason}`
    );
  }

  const { initGitHubAppMode } = await import("../github-app.js");
  const result = await initGitHubAppMode({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    appId: options.appId,
    privateKeyPath: options.privateKey,
    ...(options.installationId === undefined
      ? {}
      : { installationId: options.installationId }),
    ...(options.apiBaseUrl === undefined ? {} : { apiBaseUrl: options.apiBaseUrl }),
    ...(options.force === undefined ? {} : { force: options.force })
  });

  console.log(
    `${result.overwritten ? "Overwrote" : "Configured"} GitHub App: ${result.path}`
  );
}

export async function runGitHubAppStatusCommand(
  options: GitHubAppStatusCommandOptions
): Promise<void> {
  const { checkPermission } = await import("../rbac.js");
  const permission = await checkPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    subject: options.actor,
    permission: "github_app.read"
  });

  if (permission.decision !== "allow") {
    throw new Error(
      `Subject ${options.actor} cannot inspect GitHub App mode: ${permission.reason}`
    );
  }

  const { formatGitHubAppConfigSummary, loadGitHubAppConfig } =
    await import("../github-app.js");
  const config = await loadGitHubAppConfig({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd })
  });

  console.log(formatGitHubAppConfigSummary(config));
}
