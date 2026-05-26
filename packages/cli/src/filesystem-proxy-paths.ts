import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const SCAFFOLD_WRITE_GRANT_VERSION = "safe_cwd_scaffold_write_v1";

const DEPENDENCY_FILE_NAMES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "requirements.txt",
  "poetry.lock",
  "uv.lock",
  "go.mod",
  "go.sum",
  "Cargo.toml",
  "Cargo.lock"
]);
const UNSAFE_SCAFFOLD_PREFIXES = [
  ".git/",
  ".runstead/",
  "node_modules/",
  "dist/",
  "build/"
];

export function isSafeScaffoldWritePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  const fileName = segments.at(-1);

  if (segments.length === 0 || fileName === undefined) {
    return false;
  }

  if (
    DEPENDENCY_FILE_NAMES.has(fileName) ||
    isEnvFileName(fileName) ||
    UNSAFE_SCAFFOLD_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    segments.some((segment) => segment === "secrets" || segment === ".runstead")
  ) {
    return false;
  }

  return true;
}

export async function workspaceTarget(
  cwd: string,
  requestedPath: string,
  options: { allowMissingDescendants?: boolean } = {}
): Promise<{ absolutePath: string; relativePath: string }> {
  const root = resolve(cwd);
  const absolutePath = resolve(root, requestedPath);
  const relativePath = relative(root, absolutePath);

  if (
    relativePath.length === 0 ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath === ".." ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Workspace path escapes root: ${requestedPath}`);
  }

  await assertNoWorkspaceSymlinkTraversal(root, relativePath, requestedPath, options);

  return {
    absolutePath,
    relativePath: relativePath.split(sep).join("/")
  };
}

export function stableActionId(prefix: string, parts: unknown[]): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 12);

  return `act_${prefix.replaceAll(".", "_")}_${hash}`;
}

export function stableActionSignature(prefix: string, parts: unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify([prefix, ...parts]))
    .digest("hex");
}

async function assertNoWorkspaceSymlinkTraversal(
  root: string,
  relativePath: string,
  requestedPath: string,
  options: { allowMissingDescendants?: boolean }
): Promise<void> {
  const realRoot = await realpath(root);
  const segments = relativePath.split(sep);
  let current = realRoot;

  for (const segment of segments) {
    current = resolve(current, segment);

    try {
      const stats = await lstat(current);

      if (stats.isSymbolicLink()) {
        throw new Error(`Workspace path crosses symlink: ${requestedPath}`);
      }
    } catch (error) {
      if (
        options.allowMissingDescendants === true &&
        isNodeErrorCode(error, "ENOENT")
      ) {
        return;
      }

      throw error;
    }
  }
}

function isEnvFileName(fileName: string): boolean {
  return fileName === ".env" || fileName.startsWith(".env.");
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
