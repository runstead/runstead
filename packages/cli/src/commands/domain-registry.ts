import type { Command } from "commander";

import { collectValues } from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";

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
    .action(
      async (
        ref: string,
        options: {
          cwd?: string;
          root: string[];
          builtIns?: boolean;
          force?: boolean;
          actor: string;
        }
      ) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "domain.manage",
          action: "install domain packs"
        });

        const { installDomainPack } = await import("../domain-pack-install.js");
        const result = await installDomainPack({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ref,
          roots: options.root,
          includeBuiltIns: options.builtIns !== false,
          force: options.force === true
        });

        console.log(
          `${result.overwritten ? "Reinstalled" : "Installed"} domain pack: ${result.id}`
        );
        console.log(`Destination: ${result.destination}`);
        console.log(`Manifest: ${result.manifestPath}`);
        console.log(`Files: ${result.installedFiles.length}`);
      }
    );

  domain
    .command("uninstall")
    .description("Remove an installed domain pack from .runstead/domains.")
    .argument("<id>", "Installed domain pack id")
    .option("--cwd <path>", "Workspace directory")
    .option("--force", "Remove even when active goals or tasks still reference it")
    .option("--actor <id>", "RBAC subject for domain pack management", "local-admin")
    .action(
      async (id: string, options: { cwd?: string; force?: boolean; actor: string }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "domain.manage",
          action: "uninstall domain packs"
        });

        const { uninstallDomainPack } = await import("../domain-pack-install.js");
        const result = await uninstallDomainPack({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          id,
          force: options.force === true
        });

        console.log(`Uninstalled domain pack: ${result.id}`);
        console.log(`Destination: ${result.destination}`);
        console.log(`Active goals: ${result.activeGoals}`);
        console.log(`Active tasks: ${result.activeTasks}`);
      }
    );

  domain
    .command("upgrade")
    .description("Upgrade an installed domain pack from a validated ref.")
    .argument("<ref>", "Domain pack id or path")
    .option("--cwd <path>", "Workspace directory")
    .option("--root <path>", "Additional domain pack root", collectValues, [])
    .option("--no-built-ins", "Exclude built-in domain packs")
    .option("--force", "Upgrade even when active goals or tasks still reference it")
    .option("--actor <id>", "RBAC subject for domain pack management", "local-admin")
    .action(
      async (
        ref: string,
        options: {
          cwd?: string;
          root: string[];
          builtIns?: boolean;
          force?: boolean;
          actor: string;
        }
      ) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "domain.manage",
          action: "upgrade domain packs"
        });

        const { upgradeDomainPack } = await import("../domain-pack-install.js");
        const result = await upgradeDomainPack({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ref,
          roots: options.root,
          includeBuiltIns: options.builtIns !== false,
          force: options.force === true
        });

        console.log(`Upgraded domain pack: ${result.id}`);
        console.log(
          `Version: ${result.previousManifest?.domain.version ?? "unknown"} -> ${result.manifest.domain.version}`
        );
        console.log(`Destination: ${result.destination}`);
        console.log(`Manifest: ${result.manifestPath}`);
        console.log(`Files: ${result.installedFiles.length}`);
        console.log(`Migration steps: ${result.migrationSteps.length}`);
        console.log(`Active goals: ${result.activeGoals}`);
        console.log(`Active tasks: ${result.activeTasks}`);
      }
    );
}
