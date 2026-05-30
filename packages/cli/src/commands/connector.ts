import type { Command } from "commander";

import {
  formatRunsteadConnector,
  formatRunsteadConnectorList,
  listRunsteadConnectors,
  requireRunsteadConnector
} from "../connector-catalog.js";

export function registerConnectorCommand(program: Command): Command {
  const connector = program
    .command("connector")
    .description("Inspect Runstead data connectors.");

  connector
    .command("list")
    .description("List canonical data connectors.")
    .option("--json", "Print connector catalog as JSON")
    .action((options: ConnectorListOptions) => {
      const connectors = listRunsteadConnectors();

      if (options.json === true) {
        console.log(JSON.stringify(connectors, null, 2));
        return;
      }

      console.log(formatRunsteadConnectorList(connectors));
    });

  connector
    .command("show")
    .description("Show one connector contract.")
    .argument("<connector>", "Connector id")
    .option("--json", "Print connector contract as JSON")
    .action((connectorId: string, options: ConnectorShowOptions) => {
      const definition = requireRunsteadConnector(connectorId);

      if (options.json === true) {
        console.log(JSON.stringify(definition, null, 2));
        return;
      }

      console.log(formatRunsteadConnector(definition));
    });

  return connector;
}

interface ConnectorListOptions {
  json?: boolean;
}

interface ConnectorShowOptions {
  json?: boolean;
}
