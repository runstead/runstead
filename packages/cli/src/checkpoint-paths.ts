import { cp, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";

export async function copyUntrackedSnapshot(
  sourceRoot: string,
  destinationRoot: string,
  files: string[]
): Promise<void> {
  await Promise.all(
    files.map(async (path) => {
      const source = join(sourceRoot, path);
      const destination = join(destinationRoot, path);

      await mkdir(dirname(destination), { recursive: true });
      await cp(source, destination, { force: true, recursive: true });
    })
  );
}

export function parseNulPaths(stdout: string): string[] {
  return stdout
    .split("\0")
    .map((path) => path.trim())
    .filter((path) => path.length > 0);
}

export function isSafeRelativePath(path: string): boolean {
  const normalized = normalize(path);

  return (
    path.length > 0 &&
    !isAbsolute(path) &&
    normalized !== ".." &&
    !normalized.startsWith(`..${sep}`)
  );
}

export function isCheckpointSnapshotPath(path: string): boolean {
  return isSafeRelativePath(path) && !isCheckpointExcludedPath(path);
}

export function isCheckpointExcludedPath(path: string): boolean {
  const normalized = normalize(path);

  return (
    normalized === ".runstead" ||
    normalized.startsWith(`.runstead${sep}`) ||
    normalized === ".team" ||
    normalized.startsWith(`.team${sep}`) ||
    normalized === ".git" ||
    normalized.startsWith(`.git${sep}`) ||
    normalized === "node_modules" ||
    normalized.startsWith(`node_modules${sep}`)
  );
}
