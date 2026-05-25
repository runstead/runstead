import { normalizePath } from "./codex-direct-workspace-paths.js";

export function parseUnifiedDiffTouchedFiles(patch: string): string[] {
  const paths: string[] = [];

  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("+++ ")) {
      const path = normalizeDiffPath(line.slice(4).trim(), "b/");

      if (path !== undefined) {
        paths.push(path);
      }
    } else if (line.startsWith("--- ")) {
      const path = normalizeDiffPath(line.slice(4).trim(), "a/");

      if (path !== undefined) {
        paths.push(path);
      }
    } else if (line.startsWith("diff --git ")) {
      for (const path of parseGitDiffHeaderPaths(line)) {
        paths.push(path);
      }
    } else if (
      line.startsWith("rename from ") ||
      line.startsWith("rename to ") ||
      line.startsWith("copy from ") ||
      line.startsWith("copy to ")
    ) {
      const path = normalizeDiffPath(diffMetadataPath(line));

      if (path !== undefined) {
        paths.push(path);
      }
    }
  }

  return uniqueStrings(paths);
}

function parseGitDiffHeaderPaths(line: string): string[] {
  const tokens = splitGitDiffHeaderArgs(line.slice("diff --git ".length));
  const [left, right] = tokens;

  return [left, right]
    .map((path) => (path === undefined ? undefined : normalizeDiffPath(path)))
    .filter((path): path is string => path !== undefined);
}

function splitGitDiffHeaderArgs(value: string): string[] {
  const tokens: string[] = [];
  let index = 0;

  while (index < value.length) {
    while (/\s/.test(value[index] ?? "")) {
      index += 1;
    }

    if (index >= value.length) {
      break;
    }

    if (value[index] === '"') {
      const start = index;
      index += 1;

      while (index < value.length) {
        if (value[index] === "\\" && index + 1 < value.length) {
          index += 2;
          continue;
        }

        if (value[index] === '"') {
          index += 1;
          break;
        }

        index += 1;
      }

      tokens.push(unquoteGitPath(value.slice(start, index)));
      continue;
    }

    const start = index;

    while (index < value.length && !/\s/.test(value[index] ?? "")) {
      index += 1;
    }

    tokens.push(value.slice(start, index));
  }

  return tokens;
}

function normalizeDiffPath(path: string, prefix?: "a/" | "b/"): string | undefined {
  const unquoted = diffPathToken(path);

  if (unquoted === "/dev/null") {
    return undefined;
  }

  const withoutPrefix =
    prefix !== undefined && unquoted.startsWith(prefix)
      ? unquoted.slice(prefix.length)
      : unquoted.startsWith("a/") || unquoted.startsWith("b/")
        ? unquoted.slice(2)
        : unquoted;

  return normalizePath(withoutPrefix);
}

function diffPathToken(path: string): string {
  const trimmed = path.trim();

  if (trimmed.startsWith('"')) {
    return splitGitDiffHeaderArgs(trimmed)[0] ?? trimmed;
  }

  return trimmed.split("\t", 1)[0] ?? trimmed;
}

function diffMetadataPath(line: string): string {
  for (const prefix of ["rename from ", "rename to ", "copy from ", "copy to "]) {
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length).trim();
    }
  }

  return line.trim();
}

function unquoteGitPath(path: string): string {
  try {
    return JSON.parse(path) as string;
  } catch {
    return path;
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
