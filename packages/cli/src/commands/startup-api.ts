import type { Command } from "commander";

export function registerStartupApiCommand(startup: Command): Command {
  const startupApi = startup
    .command("api")
    .description("Expose stable JSON contracts for SDK, MCP, and automation use.");

  startupApi
    .command("snapshot")
    .description("Print a schema-versioned startup readiness snapshot.")
    .option("--cwd <path>", "Workspace directory")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .option("--json", "Print JSON output", true)
    .action(async (options: { cwd?: string; domain: string; json?: boolean }) => {
      const { startupApiSnapshot } = await import("../startup-sdk.js");
      const snapshot = await startupApiSnapshot({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        domain: options.domain
      });

      if (options.json === false) {
        console.log(
          `${snapshot.domain}: ${snapshot.status.currentStage} next=${snapshot.status.nextAction.command}`
        );
        return;
      }

      console.log(JSON.stringify(snapshot, null, 2));
    });

  return startupApi;
}
