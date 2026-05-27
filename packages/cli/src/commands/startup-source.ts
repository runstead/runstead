import type { Command } from "commander";

import {
  addStartupSourceCollectCommand,
  addStartupSourceRecordCommand,
  addStartupSourceVerifyCommand
} from "./startup-source-subcommands.js";
import { listStartupSourceConnectorContracts } from "./startup-source-contracts.js";

export function registerStartupSourceCommand(startup: Command): Command {
  const startupSource = startup
    .command("source")
    .description("Ingest startup evidence from external source connectors.");

  startupSource
    .command("list")
    .description("List startup source connector contracts.")
    .action(listStartupSourceConnectorContracts);

  addStartupSourceRecordCommand(startupSource);
  addStartupSourceVerifyCommand(startupSource);
  addStartupSourceCollectCommand(startupSource);

  return startupSource;
}
