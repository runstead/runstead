import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { DomainPackManifest } from "@runstead/domain-packs";

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function copyDomainPackFiles(input: {
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

export async function readInstalledDomainPackManifest(
  manifestPath: string
): Promise<DomainPackManifest | undefined> {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8")) as DomainPackManifest;
  } catch {
    return undefined;
  }
}
