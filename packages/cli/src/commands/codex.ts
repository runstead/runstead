import type { Command } from "commander";

interface CodexCliOptions {
  runsteadHome?: string;
}

interface CodexLoginCliOptions extends CodexCliOptions {
  baseUrl?: string;
  importCodexCli?: boolean;
  yes?: boolean;
}

interface CodexModelsCliOptions extends CodexCliOptions {
  refresh?: boolean;
}

export function registerCodexCommand(program: Command): Command {
  const codex = program
    .command("codex")
    .description("Manage experimental Codex Direct provider credentials.");

  codex
    .command("login")
    .description("Authenticate the experimental Codex Direct provider.")
    .option("--runstead-home <path>", "Override RUNSTEAD_HOME for the auth store")
    .option("--base-url <url>", "Override the Codex backend base URL")
    .option(
      "--import-codex-cli",
      "Import an existing Codex CLI token once instead of starting device login"
    )
    .option("--yes", "Confirm explicit Codex CLI token import")
    .action(async (options: CodexLoginCliOptions) => {
      const {
        importCodexCliTokens,
        loginCodexWithDeviceCode,
        formatCodexAuthStatus,
        getCodexAuthStatus
      } = await import("../codex-auth.js");

      if (options.importCodexCli === true) {
        if (options.yes !== true) {
          throw new Error(
            "--import-codex-cli requires --yes because Codex refresh tokens are single-use across clients"
          );
        }

        const imported = await importCodexCliTokens({
          ...(options.runsteadHome === undefined
            ? {}
            : { runsteadHome: options.runsteadHome }),
          ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl })
        });

        if (imported === undefined) {
          throw new Error("No valid Codex CLI credentials found to import");
        }

        console.log(`Imported Codex credentials into ${imported.authPath}`);
        console.log(
          formatCodexAuthStatus(
            await getCodexAuthStatus({
              ...(options.runsteadHome === undefined
                ? {}
                : { runsteadHome: options.runsteadHome })
            })
          )
        );
        return;
      }

      const result = await loginCodexWithDeviceCode({
        ...(options.runsteadHome === undefined
          ? {}
          : { runsteadHome: options.runsteadHome }),
        ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
        onDeviceCode: (deviceCode) => {
          console.log("To continue, open this URL in your browser:");
          console.log(`  ${deviceCode.verificationUrl}`);
          console.log("Then enter this code:");
          console.log(`  ${deviceCode.userCode}`);
          console.log("Waiting for sign-in...");
        }
      });

      console.log(`Saved Codex credentials to ${result.authPath}`);
    });

  codex
    .command("status")
    .description("Show Codex Direct authentication status without printing tokens.")
    .option("--runstead-home <path>", "Override RUNSTEAD_HOME for the auth store")
    .action(async (options: CodexCliOptions) => {
      const { formatCodexAuthStatus, getCodexAuthStatus } =
        await import("../codex-auth.js");

      console.log(
        formatCodexAuthStatus(
          await getCodexAuthStatus({
            ...(options.runsteadHome === undefined
              ? {}
              : { runsteadHome: options.runsteadHome })
          })
        )
      );
    });

  codex
    .command("logout")
    .description("Clear Codex Direct credentials from the Runstead auth store.")
    .option("--runstead-home <path>", "Override RUNSTEAD_HOME for the auth store")
    .action(async (options: CodexCliOptions) => {
      const { clearCodexAuthState } = await import("../codex-auth.js");
      const result = await clearCodexAuthState({
        ...(options.runsteadHome === undefined
          ? {}
          : { runsteadHome: options.runsteadHome })
      });

      console.log(
        result.cleared
          ? `Cleared Codex credentials from ${result.authPath}`
          : `No Codex credentials were stored at ${result.authPath}`
      );
    });

  codex
    .command("models")
    .description("List models available to the Codex Direct provider.")
    .option("--runstead-home <path>", "Override RUNSTEAD_HOME for the auth store")
    .option("--refresh", "Force an access-token refresh before listing models")
    .action(async (options: CodexModelsCliOptions) => {
      const { formatCodexModels, listCodexModels } = await import("../codex-auth.js");
      const models = await listCodexModels({
        ...(options.runsteadHome === undefined
          ? {}
          : { runsteadHome: options.runsteadHome }),
        forceRefresh: options.refresh === true
      });

      console.log(formatCodexModels(models));
    });

  return codex;
}
