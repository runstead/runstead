import { requireRbacPermission } from "../cli-rbac.js";

export interface DomainInstallCliOptions {
  cwd?: string;
  root: string[];
  builtIns?: boolean;
  force?: boolean;
  actor: string;
}

export interface DomainUninstallCliOptions {
  cwd?: string;
  force?: boolean;
  actor: string;
}

export interface DomainUpgradeCliOptions {
  cwd?: string;
  root: string[];
  builtIns?: boolean;
  force?: boolean;
  actor: string;
}

export async function installDomainPackCommand(
  ref: string,
  options: DomainInstallCliOptions
): Promise<void> {
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

export async function uninstallDomainPackCommand(
  id: string,
  options: DomainUninstallCliOptions
): Promise<void> {
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

export async function upgradeDomainPackCommand(
  ref: string,
  options: DomainUpgradeCliOptions
): Promise<void> {
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
