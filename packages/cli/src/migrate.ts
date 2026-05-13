import { constants } from "node:fs";
import { access, cp, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface MigrateRunsteadOptions {
  cwd?: string;
  source?: string;
  destination?: string;
  force?: boolean;
}

export interface MigrateRunsteadResult {
  source: string;
  destination: string;
  overwritten: boolean;
}

export async function migrateRunsteadState(
  options: MigrateRunsteadOptions = {}
): Promise<MigrateRunsteadResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const source = resolvePath(cwd, options.source ?? ".team");
  const destination = resolvePath(cwd, options.destination ?? ".runstead");
  const force = options.force ?? false;

  await assertDirectory(source, "Migration source");

  const destinationExists = await exists(destination);

  if (destinationExists && !force) {
    throw new Error(
      `Migration destination already exists: ${destination}. Use --force to overwrite.`
    );
  }

  if (destinationExists) {
    await rm(destination, { force: true, recursive: true });
  }

  await cp(source, destination, {
    errorOnExist: true,
    force: false,
    recursive: true
  });

  return {
    source,
    destination,
    overwritten: destinationExists
  };
}

function resolvePath(cwd: string, path: string): string {
  return path.startsWith("/") ? path : join(cwd, path);
}

async function assertDirectory(path: string, label: string): Promise<void> {
  try {
    await access(path, constants.R_OK);
    const pathStat = await stat(path);

    if (!pathStat.isDirectory()) {
      throw new Error(`${label} is not a directory: ${path}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("not a directory")) {
      throw error;
    }

    throw new Error(`${label} is not readable: ${path}`, {
      cause: error
    });
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
