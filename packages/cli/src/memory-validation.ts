import { accessSync, constants, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import type { MemoryRecord } from "@runstead/core";

export function validateProjectFactSources(cwd: string, sourceRefs: string[]): void {
  if (sourceRefs.length === 0) {
    throw new Error("Project facts require at least one file: source reference");
  }

  const workspaceRoot = realpathSync(cwd);

  for (const sourceRef of sourceRefs) {
    const filePath = sourceRefPath(sourceRef);
    const resolvedPath = resolve(cwd, filePath);
    const relativePath = relative(cwd, resolvedPath);

    if (escapesWorkspace(relativePath)) {
      throw new Error(`Project fact source escapes the workspace: ${sourceRef}`);
    }

    if (lstatSync(resolvedPath).isSymbolicLink()) {
      throw new Error(`Project fact source cannot be a symlink: ${sourceRef}`);
    }

    const realPath = realpathSync(resolvedPath);
    const realRelativePath = relative(workspaceRoot, realPath);

    if (escapesWorkspace(realRelativePath)) {
      throw new Error(`Project fact source escapes the workspace: ${sourceRef}`);
    }

    accessSync(realPath, constants.R_OK);
  }
}

export function rejectDuplicateProjectFact(
  existingFacts: MemoryRecord[],
  content: string
): void {
  const normalized = normalizeFactContent(content);
  const duplicate = existingFacts.find(
    (fact) => normalizeFactContent(fact.content) === normalized
  );

  if (duplicate !== undefined) {
    throw new Error(`Duplicate project fact conflicts with ${duplicate.id}`);
  }
}

export function validateProjectFactConflictRefs(
  existingFacts: MemoryRecord[],
  conflictsWith: string[]
): void {
  const ids = new Set(existingFacts.map((fact) => fact.id));
  const missing = conflictsWith.filter((id) => !ids.has(id));

  if (missing.length > 0) {
    throw new Error(
      `Project fact conflict references must point to verified facts in the same scope: ${missing.join(", ")}`
    );
  }
}

export function validateMemoryTimestamp(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`Memory ${field} must be a valid timestamp`);
  }

  return value;
}

function escapesWorkspace(relativePath: string): boolean {
  return relativePath.startsWith("..") || isAbsolute(relativePath);
}

function normalizeFactContent(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
}

function sourceRefPath(sourceRef: string): string {
  if (!sourceRef.startsWith("file:")) {
    throw new Error(`Project facts can only be verified from file: sources`);
  }

  const filePath = sourceRef.slice("file:".length);

  if (filePath.length === 0) {
    throw new Error("Project fact file source cannot be empty");
  }

  return filePath;
}
