import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import { requireSecretPrintAcknowledgement } from "../cli-secrets.js";

export function addGitHubAppCommands(github: Command): Command {
  const githubApp = github
    .command("app")
    .description("Use GitHub App mode. Experimental.");

  githubApp
    .command("init")
    .description("Configure GitHub App mode.")
    .requiredOption("--app-id <id>", "GitHub App id")
    .requiredOption("--private-key <path>", "GitHub App private key PEM path")
    .option("--cwd <path>", "Workspace directory")
    .option("--installation-id <id>", "GitHub App installation id")
    .option("--api-base-url <url>", "GitHub API base URL")
    .option("--force", "Overwrite an existing GitHub App config")
    .option("--actor <id>", "RBAC subject for GitHub App management", "local-admin")
    .action(
      async (commandOptions: {
        cwd?: string;
        appId: string;
        privateKey: string;
        installationId?: string;
        apiBaseUrl?: string;
        force?: boolean;
        actor: string;
      }) => {
        const { checkPermission } = await import("../rbac.js");
        const permission = await checkPermission({
          ...(commandOptions.cwd === undefined ? {} : { cwd: commandOptions.cwd }),
          subject: commandOptions.actor,
          permission: "github_app.manage"
        });

        if (permission.decision !== "allow") {
          throw new Error(
            `Subject ${commandOptions.actor} cannot manage GitHub App mode: ${permission.reason}`
          );
        }

        const { initGitHubAppMode } = await import("../github-app.js");
        const result = await initGitHubAppMode({
          ...(commandOptions.cwd === undefined ? {} : { cwd: commandOptions.cwd }),
          appId: commandOptions.appId,
          privateKeyPath: commandOptions.privateKey,
          ...(commandOptions.installationId === undefined
            ? {}
            : { installationId: commandOptions.installationId }),
          ...(commandOptions.apiBaseUrl === undefined
            ? {}
            : { apiBaseUrl: commandOptions.apiBaseUrl }),
          ...(commandOptions.force === undefined ? {} : { force: commandOptions.force })
        });

        console.log(
          `${result.overwritten ? "Overwrote" : "Configured"} GitHub App: ${result.path}`
        );
      }
    );

  githubApp
    .command("status")
    .description("Show GitHub App mode configuration.")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for GitHub App management", "local-admin")
    .action(async (commandOptions: { cwd?: string; actor: string }) => {
      const { checkPermission } = await import("../rbac.js");
      const permission = await checkPermission({
        ...(commandOptions.cwd === undefined ? {} : { cwd: commandOptions.cwd }),
        subject: commandOptions.actor,
        permission: "github_app.read"
      });

      if (permission.decision !== "allow") {
        throw new Error(
          `Subject ${commandOptions.actor} cannot inspect GitHub App mode: ${permission.reason}`
        );
      }

      const { formatGitHubAppConfigSummary, loadGitHubAppConfig } =
        await import("../github-app.js");
      const config = await loadGitHubAppConfig({
        ...(commandOptions.cwd === undefined ? {} : { cwd: commandOptions.cwd })
      });

      console.log(formatGitHubAppConfigSummary(config));
    });

  githubApp
    .command("jwt")
    .description("Print a signed GitHub App JWT.")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for GitHub App management", "local-admin")
    .option(
      "--print-secret",
      "Acknowledge that the GitHub App JWT will be printed to stdout"
    )
    .action(
      async (commandOptions: {
        cwd?: string;
        actor: string;
        printSecret?: boolean;
      }) => {
        requireSecretPrintAcknowledgement(commandOptions, "GitHub App JWTs");
        const { checkPermission } = await import("../rbac.js");
        const permission = await checkPermission({
          ...(commandOptions.cwd === undefined ? {} : { cwd: commandOptions.cwd }),
          subject: commandOptions.actor,
          permission: "github_app.manage"
        });

        if (permission.decision !== "allow") {
          throw new Error(
            `Subject ${commandOptions.actor} cannot sign GitHub App JWTs: ${permission.reason}`
          );
        }

        const { createGitHubAppJwtFromConfig } = await import("../github-app.js");
        const result = await createGitHubAppJwtFromConfig({
          ...(commandOptions.cwd === undefined ? {} : { cwd: commandOptions.cwd })
        });

        console.log(result.token);
      }
    );

  githubApp
    .command("token")
    .description("Print a GitHub App installation access token.")
    .option("--cwd <path>", "Workspace directory")
    .option("--installation-id <id>", "Override configured GitHub App installation id")
    .option("--actor <id>", "RBAC subject for GitHub App management", "local-admin")
    .option(
      "--print-secret",
      "Acknowledge that the installation access token will be printed to stdout"
    )
    .action(
      async (commandOptions: {
        cwd?: string;
        installationId?: string;
        actor: string;
        printSecret?: boolean;
      }) => {
        requireSecretPrintAcknowledgement(
          commandOptions,
          "GitHub App installation tokens"
        );
        await requireRbacPermission({
          ...(commandOptions.cwd === undefined ? {} : { cwd: commandOptions.cwd }),
          actor: commandOptions.actor,
          permission: "github_app.manage",
          action: "manage GitHub App mode"
        });

        const { createGitHubAppInstallationTokenFromConfig } =
          await import("../github-app.js");
        const result = await createGitHubAppInstallationTokenFromConfig({
          ...(commandOptions.cwd === undefined ? {} : { cwd: commandOptions.cwd }),
          ...(commandOptions.installationId === undefined
            ? {}
            : { installationId: commandOptions.installationId })
        });

        console.log(result.token);
      }
    );

  return githubApp;
}
