import type { Command } from "commander";

import { registerDomainBundleCommands } from "./domain-bundle.js";
import { registerDomainCatalogCommands } from "./domain-catalog.js";
import { registerDomainRegistryCommands } from "./domain-registry.js";
import { registerDomainValidationCommands } from "./domain-validation.js";

export function registerDomainCommand(program: Command): Command {
  const domain = program
    .command("domain")
    .description("Manage domain packs. Experimental.");

  registerDomainCatalogCommands(domain);
  registerDomainRegistryCommands(domain);
  registerDomainValidationCommands(domain);
  registerDomainBundleCommands(domain);

  return domain;
}
