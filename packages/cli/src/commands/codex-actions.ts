export interface CodexCliOptions {
  runsteadHome?: string;
}

export interface CodexLoginCliOptions extends CodexCliOptions {
  baseUrl?: string;
  importCodexCli?: boolean;
  yes?: boolean;
}

export interface CodexModelsCliOptions extends CodexCliOptions {
  refresh?: boolean;
}

export async function runCodexLoginCommand(
  options: CodexLoginCliOptions
): Promise<void> {
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
}

export async function runCodexStatusCommand(options: CodexCliOptions): Promise<void> {
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
}

export async function runCodexLogoutCommand(options: CodexCliOptions): Promise<void> {
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
}

export async function runCodexModelsCommand(
  options: CodexModelsCliOptions
): Promise<void> {
  const { formatCodexModels, listCodexModels } = await import("../codex-auth.js");
  const models = await listCodexModels({
    ...(options.runsteadHome === undefined
      ? {}
      : { runsteadHome: options.runsteadHome }),
    forceRefresh: options.refresh === true
  });

  console.log(formatCodexModels(models));
}
