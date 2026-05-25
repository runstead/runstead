import { lstat, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export function boundedMaxResults(
  value: number | undefined,
  fallback: number,
  limit: number
): number {
  if (value === undefined) {
    return fallback;
  }

  return Math.min(value, limit);
}

export function normalizePatterns(patterns: string[] | undefined): string[] {
  return (patterns ?? [])
    .map((pattern) => normalizePath(pattern))
    .filter((pattern) => pattern.length > 0);
}

export function matchesListInclude(path: string, patterns: string[]): boolean {
  return patterns.length === 0 || matchesAnyPattern(path, patterns);
}

export function matchesAnyPattern(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesGlob(path, pattern));
}

export function workspaceRelativePath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join("/");
}

export function workspaceTarget(
  root: string,
  requestedPath: string,
  options: { allowRoot?: boolean } = {}
): { absolutePath: string; relativePath: string } {
  const absolutePath = resolve(root, requestedPath);
  const relativePath = workspaceRelativePath(root, absolutePath);

  if (
    (relativePath.length === 0 && options.allowRoot !== true) ||
    relativePath === ".." ||
    relativePath.startsWith("../")
  ) {
    throw new Error(`Workspace path escapes root: ${requestedPath}`);
  }

  return {
    absolutePath,
    relativePath: relativePath.length === 0 ? "." : relativePath
  };
}

export function readableWorkspacePath(root: string, requestedPath: string): string {
  try {
    return workspaceTarget(root, requestedPath, { allowRoot: true }).relativePath;
  } catch {
    return normalizePath(requestedPath) || ".";
  }
}

export async function safeWorkspaceTarget(
  root: string,
  requestedPath: string,
  options: {
    allowRoot?: boolean;
    allowFinalSymlink?: boolean;
    allowMissingDescendants?: boolean;
  } = {}
): Promise<{ absolutePath: string; relativePath: string }> {
  const target = workspaceTarget(root, requestedPath, options);

  await assertNoWorkspaceSymlinkTraversal(root, target, requestedPath, options);

  return target;
}

export async function assertNoWorkspaceSymlinkTraversal(
  root: string,
  target: { relativePath: string },
  requestedPath: string,
  options: {
    allowFinalSymlink?: boolean;
    allowMissingDescendants?: boolean;
  } = {}
): Promise<void> {
  if (target.relativePath === ".") {
    return;
  }

  const realRoot = await realpath(root);
  const segments = target.relativePath.split("/");
  let current = realRoot;

  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const isFinal = index === segments.length - 1;

    try {
      const stats = await lstat(current);

      if (stats.isSymbolicLink() && !(isFinal && options.allowFinalSymlink === true)) {
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

export function normalizePath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function matchesGlob(path: string, pattern: string): boolean {
  return matchesSegments(pathSegmentsFrom(pattern), pathSegmentsFrom(path));
}

function pathSegmentsFrom(path: string): string[] {
  const normalized = normalizePath(path);

  return normalized === "" ? [] : normalized.split("/");
}

function matchesSegments(pattern: string[], path: string[]): boolean {
  if (pattern.length === 0) {
    return path.length === 0;
  }

  const currentPattern = pattern[0];
  const remainingPattern = pattern.slice(1);

  if (currentPattern === undefined) {
    return path.length === 0;
  }

  if (currentPattern === "**") {
    if (remainingPattern.length === 0) {
      return true;
    }

    for (let index = 0; index <= path.length; index += 1) {
      if (matchesSegments(remainingPattern, path.slice(index))) {
        return true;
      }
    }

    return false;
  }

  const currentPath = path[0];

  return (
    currentPath !== undefined &&
    matchesSegment(currentPattern, currentPath) &&
    matchesSegments(remainingPattern, path.slice(1))
  );
}

function matchesSegment(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const source = escaped.replaceAll("*", "[^/]*").replaceAll("?", "[^/]");

  return new RegExp(`^${source}$`).test(value);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
