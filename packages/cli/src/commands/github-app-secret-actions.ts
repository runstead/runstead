import { requireRbacPermission } from "../cli-rbac.js";
import { requireSecretPrintAcknowledgement } from "../cli-secrets.js";

export interface GitHubAppJwtCommandOptions {
  cwd?: string;
  actor: string;
  printSecret?: boolean;
}

export interface GitHubAppTokenCommandOptions {
  cwd?: string;
  installationId?: string;
  actor: string;
  printSecret?: boolean;
}

export async function runGitHubAppJwtCommand(
  options: GitHubAppJwtCommandOptions
): Promise<void> {
  requireSecretPrintAcknowledgement(options, "GitHub App JWTs");
  const { checkPermission } = await import("../rbac.js");
  const permission = await checkPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    subject: options.actor,
    permission: "github_app.manage"
  });

  if (permission.decision !== "allow") {
    throw new Error(
      `Subject ${options.actor} cannot sign GitHub App JWTs: ${permission.reason}`
    );
  }

  const { createGitHubAppJwtFromConfig } = await import("../github-app.js");
  const result = await createGitHubAppJwtFromConfig({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd })
  });

  console.log(result.token);
}

export async function runGitHubAppTokenCommand(
  options: GitHubAppTokenCommandOptions
): Promise<void> {
  requireSecretPrintAcknowledgement(options, "GitHub App installation tokens");
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "github_app.manage",
    action: "manage GitHub App mode"
  });

  const { createGitHubAppInstallationTokenFromConfig } =
    await import("../github-app.js");
  const result = await createGitHubAppInstallationTokenFromConfig({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.installationId === undefined
      ? {}
      : { installationId: options.installationId })
  });

  console.log(result.token);
}
