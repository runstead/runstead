import type { Command } from "commander";

import {
  addStartupSourceCollectCommand,
  addStartupSourceRecordCommand,
  addStartupSourceVerifyCommand
} from "./startup-source-subcommands.js";
import { listStartupSourceConnectorContracts } from "./startup-source-contracts.js";
import {
  planStartupSourceCommand,
  type StartupSourcePlanCommandOptions
} from "./startup-source-plan.js";

export function registerStartupSourceCommand(startup: Command): Command {
  const startupSource = startup
    .command("source")
    .description("Ingest startup evidence from external source connectors.");

  startupSource
    .command("list")
    .description("List startup source connector contracts.")
    .action(listStartupSourceConnectorContracts);

  startupSource
    .command("plan")
    .description(
      "Plan staging or production source connector refresh commands and setup blockers."
    )
    .requiredOption(
      "--target <target>",
      "Readiness target to refresh: local, staging, or production"
    )
    .option("--format <format>", "Output format: text or json", "text")
    .action((options: StartupSourcePlanCommandOptions) =>
      planStartupSourceCommand(options)
    );

  addStartupSourceRecordCommand(startupSource);
  addStartupSourceVerifyCommand(startupSource);
  addStartupSourceCollectCommand(startupSource);

  return startupSource;
}
