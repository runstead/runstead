import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  applyCodexPatchHunks,
  parseCodexApplyPatchOperations,
  parseCodexApplyPatchTouchedFiles
} from "./codex-direct-apply-patch.js";
import {
  normalizePath,
  safeWorkspaceTarget,
  workspaceTarget
} from "./codex-direct-workspace-paths.js";
import { parseUnifiedDiffTouchedFiles } from "./codex-direct-unified-diff.js";
import { runShellCommand } from "./shell-executor.js";

export interface ApplyWorkspacePatchReplacement {
  path: string;
  search: string;
  replace: string;
  replaceAll?: boolean;
}

export interface ApplyWorkspacePatchOptions {
  patch?: string;
  replacements?: ApplyWorkspacePatchReplacement[];
}

export interface ApplyWorkspacePatchResult {
  mode: "unified_diff" | "replacements";
  filesTouched: string[];
  applied: boolean;
  summary: string;
}

export async function applyWorkspacePatch(
  cwd: string,
  options: ApplyWorkspacePatchOptions
): Promise<ApplyWorkspacePatchResult> {
  const root = resolve(cwd);

  if (options.patch !== undefined && options.replacements !== undefined) {
    throw new Error("apply_patch accepts either patch or replacements, not both");
  }

  if (options.patch !== undefined) {
    if (parseCodexApplyPatchTouchedFiles(options.patch).length > 0) {
      return applyCodexApplyPatch(root, options.patch);
    }

    return applyUnifiedDiff(root, options.patch);
  }

  if (options.replacements !== undefined) {
    return applyStructuredReplacements(root, options.replacements);
  }

  throw new Error("apply_patch requires patch or replacements");
}

export function inferWorkspacePatchTouchedFiles(
  options: ApplyWorkspacePatchOptions
): string[] {
  if (options.replacements !== undefined) {
    return uniqueStrings(
      options.replacements.map((replacement) => normalizePath(replacement.path))
    );
  }

  if (options.patch !== undefined) {
    return uniqueStrings([
      ...parseUnifiedDiffTouchedFiles(options.patch),
      ...parseCodexApplyPatchTouchedFiles(options.patch)
    ]);
  }

  return [];
}

async function applyUnifiedDiff(
  root: string,
  patch: string
): Promise<ApplyWorkspacePatchResult> {
  const filesTouched = parseUnifiedDiffTouchedFiles(patch);

  if (filesTouched.length === 0) {
    throw new Error("Unified diff does not contain any workspace file paths");
  }

  for (const path of filesTouched) {
    await safeWorkspaceTarget(root, path, {
      allowRoot: false,
      allowMissingDescendants: true
    });
  }

  const tempDir = await mkdtemp(join(tmpdir(), "runstead-apply-patch-"));
  const patchPath = join(tempDir, "change.patch");

  try {
    await writeFile(patchPath, patch, "utf8");
    const check = await runShellCommand({
      command: `git apply --check --whitespace=nowarn ${shellQuote(patchPath)}`,
      cwd: root
    });

    if (check.exitCode !== 0) {
      throw new Error(check.stderr || check.stdout || "git apply --check failed");
    }

    const applied = await runShellCommand({
      command: `git apply --whitespace=nowarn ${shellQuote(patchPath)}`,
      cwd: root
    });

    if (applied.exitCode !== 0) {
      throw new Error(applied.stderr || applied.stdout || "git apply failed");
    }

    return {
      mode: "unified_diff",
      filesTouched,
      applied: true,
      summary: `Applied unified diff to ${filesTouched.length} file(s)`
    };
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

async function applyCodexApplyPatch(
  root: string,
  patch: string
): Promise<ApplyWorkspacePatchResult> {
  const operations = parseCodexApplyPatchOperations(patch);
  const filesTouched = uniqueStrings(
    operations.flatMap((operation) => [
      operation.path,
      ...(operation.moveTo === undefined ? [] : [operation.moveTo])
    ])
  );

  if (operations.length === 0 || filesTouched.length === 0) {
    throw new Error("Codex apply patch does not contain any workspace file paths");
  }

  for (const path of filesTouched) {
    await safeWorkspaceTarget(root, path, {
      allowRoot: false,
      allowMissingDescendants: true
    });
  }

  for (const operation of operations) {
    if (operation.kind === "add") {
      const target = await safeWorkspaceTarget(root, operation.path, {
        allowRoot: false,
        allowMissingDescendants: true
      });

      await mkdir(dirname(target.absolutePath), { recursive: true });
      await writeFile(target.absolutePath, operation.content.join("\n"), "utf8");
      continue;
    }

    if (operation.kind === "delete") {
      const target = await safeWorkspaceTarget(root, operation.path);

      await rm(target.absolutePath, { force: true });
      continue;
    }

    const source = await safeWorkspaceTarget(root, operation.path);
    const destination =
      operation.moveTo === undefined
        ? source
        : await safeWorkspaceTarget(root, operation.moveTo, {
            allowRoot: false,
            allowMissingDescendants: true
          });
    const original = await readFile(source.absolutePath, "utf8");
    const updated = applyCodexPatchHunks(original, operation.hunks, operation.path);

    await mkdir(dirname(destination.absolutePath), { recursive: true });
    await writeFile(destination.absolutePath, updated, "utf8");

    if (destination.absolutePath !== source.absolutePath) {
      await rm(source.absolutePath, { force: true });
    }
  }

  return {
    mode: "unified_diff",
    filesTouched,
    applied: true,
    summary: `Applied Codex apply patch to ${filesTouched.length} file(s)`
  };
}

async function applyStructuredReplacements(
  root: string,
  replacements: ApplyWorkspacePatchReplacement[]
): Promise<ApplyWorkspacePatchResult> {
  if (replacements.length === 0) {
    throw new Error("apply_patch replacements must not be empty");
  }

  const filesTouched = uniqueStrings(
    replacements.map(
      (replacement) => workspaceTarget(root, replacement.path).relativePath
    )
  );

  for (const replacement of replacements) {
    if (replacement.search.length === 0) {
      throw new Error(`Replacement search text must not be empty: ${replacement.path}`);
    }

    const target = await safeWorkspaceTarget(root, replacement.path);
    const original = await readFile(target.absolutePath, "utf8");
    const occurrences = countOccurrences(original, replacement.search);

    if (occurrences === 0) {
      throw new Error(`Replacement search text not found: ${replacement.path}`);
    }

    if (occurrences > 1 && replacement.replaceAll !== true) {
      throw new Error(
        `Replacement search text is ambiguous in ${replacement.path}; set replaceAll to true`
      );
    }

    const updated =
      replacement.replaceAll === true
        ? original.split(replacement.search).join(replacement.replace)
        : original.replace(replacement.search, replacement.replace);

    await writeFile(target.absolutePath, updated, "utf8");
  }

  return {
    mode: "replacements",
    filesTouched,
    applied: true,
    summary: `Applied ${replacements.length} structured replacement(s) to ${filesTouched.length} file(s)`
  };
}

function countOccurrences(value: string, search: string): number {
  return value.split(search).length - 1;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
