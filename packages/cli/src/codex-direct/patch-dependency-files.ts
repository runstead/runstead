const DEPENDENCY_FILE_NAMES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb"
]);

export function isDependencyFilePath(path: string): boolean {
  const fileName = path.split("/").pop() ?? path;

  return DEPENDENCY_FILE_NAMES.has(fileName);
}
