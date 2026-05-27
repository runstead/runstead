import type { Task } from "@runstead/core";

import { matchesPolicyPathPattern } from "../policy.js";
import { stringArray } from "./patch-payload-value-parsers.js";
import { isRecord } from "./tool-json.js";

export interface CodexDirectTaskScaffoldProfile {
  id: string;
  appOwnedPaths: string[];
}

const SCAFFOLD_APP_PATCH_PROTECTED_PATH_PATTERNS = [
  ".env",
  ".env.*",
  "**/secrets/**",
  ".git/**",
  ".runstead/**",
  "infra/prod/**",
  "node_modules/**",
  "dist/**",
  "build/**"
];

export function codexDirectTaskScaffoldProfile(
  task: Task
): CodexDirectTaskScaffoldProfile | undefined {
  const profile = task.input.scaffoldProfile;

  if (!isRecord(profile) || typeof profile.id !== "string") {
    return undefined;
  }

  const appOwnedPaths = stringArray(profile.appOwnedPaths);

  if (appOwnedPaths === undefined || appOwnedPaths.length === 0) {
    return undefined;
  }

  return {
    id: profile.id,
    appOwnedPaths
  };
}

export function isScaffoldAppOwnedPatchPath(
  path: string,
  appOwnedPaths: string[]
): boolean {
  if (
    SCAFFOLD_APP_PATCH_PROTECTED_PATH_PATTERNS.some((pattern) =>
      matchesPolicyPathPattern(path, pattern)
    )
  ) {
    return false;
  }

  return appOwnedPaths.some((pattern) => matchesPolicyPathPattern(path, pattern));
}
