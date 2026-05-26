import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  buildDomainPackManifest,
  checkDomainPackCompatibility,
  resolveDomainPackRef,
  type DomainPackManifest
} from "@runstead/domain-packs";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  domainPackInstalledEvent,
  domainPackMigrationSteps,
  domainPackUninstalledEvent,
  domainPackUpgradedEvent
} from "./domain-pack-install-events.js";
import {
  copyDomainPackFiles,
  pathExists,
  readInstalledDomainPackManifest
} from "./domain-pack-install-files.js";
import type {
  InstallDomainPackOptions,
  InstallDomainPackResult,
  UninstallDomainPackOptions,
  UninstallDomainPackResult,
  UpgradeDomainPackOptions,
  UpgradeDomainPackResult
} from "./domain-pack-install-types.js";

export type {
  InstallDomainPackOptions,
  InstallDomainPackResult,
  UninstallDomainPackOptions,
  UninstallDomainPackResult,
  UpgradeDomainPackOptions,
  UpgradeDomainPackResult
} from "./domain-pack-install-types.js";

const DOMAIN_PACK_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const RUNSTEAD_CLI_VERSION = "0.0.0";

export async function installDomainPack(
  options: InstallDomainPackOptions
): Promise<InstallDomainPackResult> {
  const resolvedRoot = await requireRunsteadStateDb(
    resolve(options.cwd ?? process.cwd())
  );
  const roots = [...(options.roots ?? [])];
  const entry = await resolveDomainPackRef(options.ref, {
    roots,
    ...(options.includeBuiltIns === undefined
      ? {}
      : { includeBuiltIns: options.includeBuiltIns })
  });
  const manifest = await buildDomainPackManifest(entry.root);
  assertCompatibleDomainPack(manifest);
  const destination = join(resolvedRoot.root, "domains", entry.id);
  const sourceRoot = resolve(entry.root);
  const destinationRoot = resolve(destination);
  const existing = await pathExists(destinationRoot);

  if (sourceRoot === destinationRoot) {
    throw new Error(`Domain pack is already installed at ${destinationRoot}`);
  }

  if (existing && options.force !== true) {
    throw new Error(`Domain pack already installed: ${entry.id}`);
  }

  if (existing) {
    await rm(destinationRoot, { force: true, recursive: true });
  }

  await mkdir(destinationRoot, { recursive: true });

  const installedFiles = await copyDomainPackFiles({
    sourceRoot,
    destinationRoot,
    manifest
  });

  const manifestPath = join(destinationRoot, "runstead-manifest.json");

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const event = domainPackInstalledEvent({
    id: entry.id,
    destination: destinationRoot,
    manifestPath,
    manifest,
    overwritten: existing,
    createdAt: (options.now ?? new Date()).toISOString()
  });
  const database = openRunsteadDatabase(resolvedRoot.stateDb);

  try {
    appendEventAndProject(database, { event });
  } finally {
    database.close();
  }

  return {
    id: entry.id,
    source: entry,
    destination: destinationRoot,
    manifest,
    manifestPath,
    installedFiles,
    overwritten: existing,
    event
  };
}

export async function uninstallDomainPack(
  options: UninstallDomainPackOptions
): Promise<UninstallDomainPackResult> {
  if (!DOMAIN_PACK_ID_PATTERN.test(options.id)) {
    throw new Error(`Invalid domain pack id: ${options.id}`);
  }

  const resolved = await requireRunsteadStateDb(resolve(options.cwd ?? process.cwd()));
  const destination = resolve(resolved.root, "domains", options.id);
  const manifestPath = join(destination, "runstead-manifest.json");

  if (!(await pathExists(destination))) {
    throw new Error(`Domain pack is not installed: ${options.id}`);
  }

  const manifest = await readInstalledDomainPackManifest(manifestPath);
  const database = openRunsteadDatabase(resolved.stateDb);

  try {
    const usage = readDomainUsage(database, options.id);

    if (options.force !== true && (usage.activeGoals > 0 || usage.activeTasks > 0)) {
      throw new Error(
        `Domain pack ${options.id} is still in use by ${usage.activeGoals} active goal(s) and ${usage.activeTasks} active task(s)`
      );
    }

    await rm(destination, { force: true, recursive: true });

    const uninstalledAt = (options.now ?? new Date()).toISOString();
    const event = domainPackUninstalledEvent({
      id: options.id,
      destination,
      manifestPath,
      activeGoals: usage.activeGoals,
      activeTasks: usage.activeTasks,
      forced: options.force === true,
      createdAt: uninstalledAt,
      ...(manifest === undefined ? {} : { manifest })
    });

    appendEventAndProject(database, { event });

    return {
      id: options.id,
      destination,
      manifestPath,
      activeGoals: usage.activeGoals,
      activeTasks: usage.activeTasks,
      removed: true,
      ...(manifest === undefined ? {} : { manifest })
    };
  } finally {
    database.close();
  }
}

export async function upgradeDomainPack(
  options: UpgradeDomainPackOptions
): Promise<UpgradeDomainPackResult> {
  const resolved = await requireRunsteadStateDb(resolve(options.cwd ?? process.cwd()));
  const roots = [...(options.roots ?? [])];
  const entry = await resolveDomainPackRef(options.ref, {
    roots,
    ...(options.includeBuiltIns === undefined
      ? {}
      : { includeBuiltIns: options.includeBuiltIns })
  });
  const manifest = await buildDomainPackManifest(entry.root);
  assertCompatibleDomainPack(manifest);
  const destination = join(resolved.root, "domains", entry.id);
  const sourceRoot = resolve(entry.root);
  const destinationRoot = resolve(destination);
  const manifestPath = join(destinationRoot, "runstead-manifest.json");

  if (sourceRoot === destinationRoot) {
    throw new Error(`Domain pack source is already the installed pack: ${entry.id}`);
  }

  if (!(await pathExists(destinationRoot))) {
    throw new Error(`Domain pack is not installed: ${entry.id}`);
  }

  const previousManifest = await readInstalledDomainPackManifest(manifestPath);
  const migrationSteps = domainPackMigrationSteps({
    ...(previousManifest === undefined ? {} : { previousManifest }),
    manifest
  });
  const database = openRunsteadDatabase(resolved.stateDb);

  try {
    const usage = readDomainUsage(database, entry.id);

    if (options.force !== true && (usage.activeGoals > 0 || usage.activeTasks > 0)) {
      throw new Error(
        `Domain pack ${entry.id} is still in use by ${usage.activeGoals} active goal(s) and ${usage.activeTasks} active task(s)`
      );
    }

    await rm(destinationRoot, { force: true, recursive: true });
    await mkdir(destinationRoot, { recursive: true });

    const installedFiles = await copyDomainPackFiles({
      sourceRoot,
      destinationRoot,
      manifest
    });

    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    appendEventAndProject(database, {
      event: domainPackUpgradedEvent({
        id: entry.id,
        destination: destinationRoot,
        manifestPath,
        ...(previousManifest === undefined ? {} : { previousManifest }),
        manifest,
        migrationSteps,
        activeGoals: usage.activeGoals,
        activeTasks: usage.activeTasks,
        forced: options.force === true,
        createdAt: (options.now ?? new Date()).toISOString()
      })
    });

    return {
      id: entry.id,
      source: entry,
      destination: destinationRoot,
      manifest,
      manifestPath,
      installedFiles,
      ...(previousManifest === undefined ? {} : { previousManifest }),
      migrationSteps,
      activeGoals: usage.activeGoals,
      activeTasks: usage.activeTasks,
      forced: options.force === true
    };
  } finally {
    database.close();
  }
}

function readDomainUsage(
  database: ReturnType<typeof openRunsteadDatabase>,
  domainId: string
): { activeGoals: number; activeTasks: number } {
  const activeGoals = database
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM goals
      WHERE domain = ?
        AND status IN ('active', 'paused')
    `
    )
    .get(domainId) as { count: number };
  const activeTasks = database
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM tasks
      WHERE domain = ?
        AND status IN ('queued', 'claimed', 'running', 'waiting_approval', 'blocked')
    `
    )
    .get(domainId) as { count: number };

  return {
    activeGoals: activeGoals.count,
    activeTasks: activeTasks.count
  };
}

function assertCompatibleDomainPack(manifest: DomainPackManifest): void {
  const compatibility = checkDomainPackCompatibility(
    {
      id: manifest.domain.id,
      compatibility: manifest.compatibility
    },
    RUNSTEAD_CLI_VERSION
  );

  if (!compatibility.compatible) {
    throw new Error(
      `Domain pack ${manifest.domain.id} is not compatible with Runstead ${RUNSTEAD_CLI_VERSION}: ${compatibility.issues
        .map((issue) => issue.message)
        .join("; ")}`
    );
  }
}
