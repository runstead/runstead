export type CodexApplyPatchOperation =
  | {
      kind: "add";
      path: string;
      content: string[];
      moveTo?: undefined;
      hunks?: undefined;
    }
  | {
      kind: "delete";
      path: string;
      moveTo?: undefined;
      content?: undefined;
      hunks?: undefined;
    }
  | {
      kind: "update";
      path: string;
      moveTo?: string;
      hunks: CodexApplyPatchHunk[];
      content?: undefined;
    };

export interface CodexApplyPatchHunk {
  oldLines: string[];
  newLines: string[];
}

export function parseCodexApplyPatchTouchedFiles(patch: string): string[] {
  const paths: string[] = [];

  for (const line of patch.split(/\r?\n/)) {
    const fileMatch = /^\*\*\* (?:Add|Update|Delete) File:\s*(?<path>.+?)\s*$/.exec(
      line
    );

    if (fileMatch?.groups?.path !== undefined) {
      paths.push(normalizePath(fileMatch.groups.path));
      continue;
    }

    const moveMatch = /^\*\*\* Move to:\s*(?<path>.+?)\s*$/.exec(line);

    if (moveMatch?.groups?.path !== undefined) {
      paths.push(normalizePath(moveMatch.groups.path));
    }
  }

  return uniqueStrings(paths);
}

export function parseCodexApplyPatchOperations(
  patch: string
): CodexApplyPatchOperation[] {
  const lines = patch.split(/\r?\n/);
  const operations: CodexApplyPatchOperation[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fileMatch = /^\*\*\* (Add|Update|Delete) File:\s*(?<path>.+?)\s*$/.exec(line);

    if (fileMatch?.groups?.path === undefined) {
      index += 1;
      continue;
    }

    const kind = fileMatch[1];
    const path = normalizePath(fileMatch.groups.path);

    index += 1;

    if (kind === "Add") {
      const content: string[] = [];

      while (index < lines.length && !(lines[index] ?? "").startsWith("*** ")) {
        const contentLine = lines[index] ?? "";

        if (!contentLine.startsWith("+")) {
          throw new Error(`Invalid Codex add-file patch line for ${path}`);
        }

        content.push(contentLine.slice(1));
        index += 1;
      }

      operations.push({
        kind: "add",
        path,
        content: ensureTrailingNewlineLines(content)
      });
      continue;
    }

    if (kind === "Delete") {
      operations.push({ kind: "delete", path });

      while (index < lines.length && !(lines[index] ?? "").startsWith("*** ")) {
        index += 1;
      }

      continue;
    }

    let moveTo: string | undefined;
    const hunks: CodexApplyPatchHunk[] = [];
    let currentHunk: CodexApplyPatchHunk = { oldLines: [], newLines: [] };

    while (index < lines.length) {
      const bodyLine = lines[index] ?? "";
      const moveMatch = /^\*\*\* Move to:\s*(?<path>.+?)\s*$/.exec(bodyLine);

      if (
        bodyLine.startsWith("*** ") &&
        moveMatch === null &&
        !bodyLine.startsWith("*** End of File")
      ) {
        break;
      }

      if (moveMatch?.groups?.path !== undefined) {
        moveTo = normalizePath(moveMatch.groups.path);
        index += 1;
        continue;
      }

      if (bodyLine.startsWith("@@")) {
        pushCodexPatchHunk(hunks, currentHunk);
        currentHunk = { oldLines: [], newLines: [] };
        index += 1;
        continue;
      }

      if (bodyLine.startsWith("*** End of File")) {
        index += 1;
        continue;
      }

      if (bodyLine.startsWith("+")) {
        currentHunk.newLines.push(bodyLine.slice(1));
      } else if (bodyLine.startsWith("-")) {
        currentHunk.oldLines.push(bodyLine.slice(1));
      } else if (bodyLine.startsWith(" ")) {
        const value = bodyLine.slice(1);

        currentHunk.oldLines.push(value);
        currentHunk.newLines.push(value);
      } else if (bodyLine.trim().length !== 0) {
        const value = bodyLine;

        currentHunk.oldLines.push(value);
        currentHunk.newLines.push(value);
      }

      index += 1;
    }

    pushCodexPatchHunk(hunks, currentHunk);
    operations.push({
      kind: "update",
      path,
      ...(moveTo === undefined ? {} : { moveTo }),
      hunks
    });
  }

  return operations;
}

export function applyCodexPatchHunks(
  original: string,
  hunks: CodexApplyPatchHunk[],
  path: string
): string {
  let updated = original;

  for (const hunk of hunks) {
    const oldText = hunk.oldLines.join("\n");
    const newText = hunk.newLines.join("\n");

    if (oldText.length === 0) {
      updated = `${trimOneTrailingNewline(updated)}\n${newText}\n`;
      continue;
    }

    const index = updated.indexOf(oldText);

    if (index === -1) {
      throw new Error(`Codex patch hunk did not match ${path}`);
    }

    updated = `${updated.slice(0, index)}${newText}${updated.slice(index + oldText.length)}`;
  }

  return updated;
}

function pushCodexPatchHunk(
  hunks: CodexApplyPatchHunk[],
  hunk: CodexApplyPatchHunk
): void {
  if (hunk.oldLines.length === 0 && hunk.newLines.length === 0) {
    return;
  }

  hunks.push(hunk);
}

function ensureTrailingNewlineLines(lines: string[]): string[] {
  if (lines.at(-1) === "") {
    return lines;
  }

  return [...lines, ""];
}

function trimOneTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

function normalizePath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
