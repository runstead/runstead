import type { Command } from "commander";

import { collectValues } from "../cli-parsers.js";
import {
  installDomainPackCommand,
  uninstallDomainPackCommand,
  upgradeDomainPackCommand
} from "./domain-registry-actions.js";

export function registerDomainRegistryCommands(domain: Command): void {
  domain
    .command("install")
    .description("Install a validated domain pack into .runstead/domains.")
    .argument("<ref>", "Domain pack id or path")
    .option("--cwd <path>", "Workspace directory")
    .option("--root <path>", "Additional domain pack root", collectValues, [])
    .option("--no-built-ins", "Exclude built-in domain packs")
    .option("--force", "Overwrite an installed domain pack")
    .option("--actor <id>", "RBAC subject for domain pack management", "local-admin")
    .action(installDomainPackCommand);

  domain
    .command("uninstall")
    .description("Remove an installed domain pack from .runstead/domains.")
    .argument("<id>", "Installed domain pack id")
    .option("--cwd <path>", "Workspace directory")
    .option("--force", "Remove even when active goals or tasks still reference it")
    .option("--actor <id>", "RBAC subject for domain pack management", "local-admin")
    .action(uninstallDomainPackCommand);

  domain
    .command("upgrade")
    .description("Upgrade an installed domain pack from a validated ref.")
    .argument("<ref>", "Domain pack id or path")
    .option("--cwd <path>", "Workspace directory")
    .option("--root <path>", "Additional domain pack root", collectValues, [])
    .option("--no-built-ins", "Exclude built-in domain packs")
    .option("--force", "Upgrade even when active goals or tasks still reference it")
    .option("--actor <id>", "RBAC subject for domain pack management", "local-admin")
    .action(upgradeDomainPackCommand);
}
