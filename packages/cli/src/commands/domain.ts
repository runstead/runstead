import type { Command } from "commander";

import { registerDomainBundleCommands } from "./domain-bundle.js";
import { registerDomainCatalogCommands } from "./domain-catalog.js";
import { registerDomainRegistryCommands } from "./domain-registry.js";

export function registerDomainCommand(program: Command): Command {
  const domain = program
    .command("domain")
    .description("Manage domain packs. Experimental.");

  registerDomainCatalogCommands(domain);
  registerDomainRegistryCommands(domain);

  domain
    .command("validate")
    .description("Validate a domain pack directory.")
    .argument("<path>", "Domain pack directory")
    .action(async (path: string) => {
      const { formatDomainPackValidationResult, validateDomainPackDir } =
        await import("@runstead/domain-packs");
      const result = await validateDomainPackDir(path);

      console.log(formatDomainPackValidationResult(result));
      if (!result.valid) {
        process.exitCode = 1;
      }
    });

  domain
    .command("maturity")
    .description(
      "Assess domain pack maturity for schema, migrations, gates, fixtures, and reports."
    )
    .argument("<path>", "Domain pack directory")
    .action(async (path: string) => {
      const { assessDomainPackMaturity, formatDomainPackMaturityResult } =
        await import("@runstead/domain-packs");
      const result = await assessDomainPackMaturity(path);

      console.log(formatDomainPackMaturityResult(result));
      if (!result.passed) {
        process.exitCode = 1;
      }
    });

  registerDomainBundleCommands(domain);

  return domain;
}
