import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import {
  buildDomainPackManifest,
  checkDomainPackCompatibility,
  resolveDomainPackRef,
  type DomainPackManifest,
  type DomainPackRegistryEntry
} from "@runstead/domain-packs";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDb } from "./runstead-root.js";

export interface InstallDomainPackOptions {
  cwd?: string;
  ref: string;
  roots?: string[];
  includeBuiltIns?: boolean;
  force?: boolean;
  now?: Date;
}

export interface InstallDomainPackResult {
  id: string;
  source: DomainPackRegistryEntry;
  destination: string;
  manifest: DomainPackManifest;
  manifestPath: string;
  installedFiles: string[];
  overwritten: boolean;
  event: RunsteadEvent;
}

export interface UninstallDomainPackOptions {
  cwd?: string;
  id: string;
  force?: boolean;
  now?: Date;
}

export interface UpgradeDomainPackOptions {
  cwd?: string;
  ref: string;
  roots?: string[];
  includeBuiltIns?: boolean;
  force?: boolean;
  now?: Date;
}

export interface UninstallDomainPackResult {
  id: string;
  destination: string;
  manifestPath: string;
  activeGoals: number;
  activeTasks: number;
  removed: boolean;
  manifest?: DomainPackManifest;
}

export interface UpgradeDomainPackResult {
  id: string;
  source: DomainPackRegistryEntry;
  destination: string;
  manifest: DomainPackManifest;
  manifestPath: string;
  installedFiles: string[];
  previousManifest?: DomainPackManifest;
  activeGoals: number;
  activeTasks: number;
  forced: boolean;
}

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
  const existing = await exists(destinationRoot);

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

  if (!(await exists(destination))) {
    throw new Error(`Domain pack is not installed: ${options.id}`);
  }

  const manifest = await readInstalledManifest(manifestPath);
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

  if (!(await exists(destinationRoot))) {
    throw new Error(`Domain pack is not installed: ${entry.id}`);
  }

  const previousManifest = await readInstalledManifest(manifestPath);
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
      activeGoals: usage.activeGoals,
      activeTasks: usage.activeTasks,
      forced: options.force === true
    };
  } finally {
    database.close();
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function copyDomainPackFiles(input: {
  sourceRoot: string;
  destinationRoot: string;
  manifest: DomainPackManifest;
}): Promise<string[]> {
  const installedFiles: string[] = [];

  for (const file of input.manifest.files) {
    const source = join(input.sourceRoot, file.path);
    const destinationPath = join(input.destinationRoot, file.path);

    await mkdir(dirname(destinationPath), { recursive: true });
    await copyFile(source, destinationPath);
    installedFiles.push(file.path);
  }

  return installedFiles;
}

async function readInstalledManifest(
  manifestPath: string
): Promise<DomainPackManifest | undefined> {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8")) as DomainPackManifest;
  } catch {
    return undefined;
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

function domainPackUninstalledEvent(input: {
  id: string;
  destination: string;
  manifestPath: string;
  manifest?: DomainPackManifest;
  activeGoals: number;
  activeTasks: number;
  forced: boolean;
  createdAt: string;
}): RunsteadEvent {
  return {
    eventId: createRunsteadId("evt"),
    type: "domain_pack.uninstalled",
    aggregateType: "domain_pack",
    aggregateId: input.id,
    payload: {
      id: input.id,
      destination: input.destination,
      manifestPath: input.manifestPath,
      version: input.manifest?.domain.version ?? null,
      files: input.manifest?.files.length ?? null,
      activeGoals: input.activeGoals,
      activeTasks: input.activeTasks,
      forced: input.forced
    },
    createdAt: input.createdAt
  };
}

function domainPackInstalledEvent(input: {
  id: string;
  destination: string;
  manifestPath: string;
  manifest: DomainPackManifest;
  overwritten: boolean;
  createdAt: string;
}): RunsteadEvent {
  return {
    eventId: createRunsteadId("evt"),
    type: "domain_pack.installed",
    aggregateType: "domain_pack",
    aggregateId: input.id,
    payload: {
      id: input.id,
      destination: input.destination,
      manifestPath: input.manifestPath,
      version: input.manifest.domain.version,
      files: input.manifest.files.length,
      overwritten: input.overwritten
    },
    createdAt: input.createdAt
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

function domainPackUpgradedEvent(input: {
  id: string;
  destination: string;
  manifestPath: string;
  previousManifest?: DomainPackManifest;
  manifest: DomainPackManifest;
  activeGoals: number;
  activeTasks: number;
  forced: boolean;
  createdAt: string;
}): RunsteadEvent {
  return {
    eventId: createRunsteadId("evt"),
    type: "domain_pack.upgraded",
    aggregateType: "domain_pack",
    aggregateId: input.id,
    payload: {
      id: input.id,
      destination: input.destination,
      manifestPath: input.manifestPath,
      previousVersion: input.previousManifest?.domain.version ?? null,
      nextVersion: input.manifest.domain.version,
      previousFiles: input.previousManifest?.files.length ?? null,
      nextFiles: input.manifest.files.length,
      activeGoals: input.activeGoals,
      activeTasks: input.activeTasks,
      forced: input.forced
    },
    createdAt: input.createdAt
  };
}
