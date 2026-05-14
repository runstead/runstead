import { constants } from "node:fs";
import { access, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  buildDomainPackManifest,
  resolveDomainPackRef,
  type DomainPackManifest,
  type DomainPackRegistryEntry
} from "@runstead/domain-packs";

import { requireRunsteadRoot } from "./runstead-root.js";

export interface InstallDomainPackOptions {
  cwd?: string;
  ref: string;
  roots?: string[];
  includeBuiltIns?: boolean;
  force?: boolean;
}

export interface InstallDomainPackResult {
  id: string;
  source: DomainPackRegistryEntry;
  destination: string;
  manifest: DomainPackManifest;
  manifestPath: string;
  installedFiles: string[];
  overwritten: boolean;
}

export async function installDomainPack(
  options: InstallDomainPackOptions
): Promise<InstallDomainPackResult> {
  const resolvedRoot = await requireRunsteadRoot(resolve(options.cwd ?? process.cwd()));
  const roots = [...(options.roots ?? [])];
  const entry = await resolveDomainPackRef(options.ref, {
    roots,
    ...(options.includeBuiltIns === undefined
      ? {}
      : { includeBuiltIns: options.includeBuiltIns })
  });
  const manifest = await buildDomainPackManifest(entry.root);
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

  const installedFiles: string[] = [];

  for (const file of manifest.files) {
    const source = join(sourceRoot, file.path);
    const destinationPath = join(destinationRoot, file.path);

    await mkdir(dirname(destinationPath), { recursive: true });
    await copyFile(source, destinationPath);
    installedFiles.push(file.path);
  }

  const manifestPath = join(destinationRoot, "runstead-manifest.json");

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    id: entry.id,
    source: entry,
    destination: destinationRoot,
    manifest,
    manifestPath,
    installedFiles,
    overwritten: existing
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
