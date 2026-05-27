import type { Task } from "@runstead/core";

import { isDependencyFilePath } from "./patch-dependency-files.js";
import { sha256 } from "./patch-hash.js";
import {
  codexDirectTaskScaffoldProfile,
  isScaffoldAppOwnedPatchPath
} from "./patch-scaffold-profile.js";

export interface CodexDirectPatchApprovalMetadata {
  diffHash: string;
  riskClass: "workspace_patch" | "dependency_patch" | "scaffold_app_patch";
  dependencyImpact: {
    kind: "none" | "dependency_files_touched";
    files: string[];
  };
  riskSummary: string;
  canonicalSignature: string;
  approvalGrant?: {
    mode: "scoped_until_expiry";
    scope: string;
  };
}

export function codexDirectPatchApprovalMetadata(input: {
  cwd: string;
  task: Task;
  filesTouched: string[];
  patch?: string;
  replacements?: {
    path: string;
    search: string;
    replace: string;
    replaceAll?: boolean;
  }[];
}): CodexDirectPatchApprovalMetadata {
  const sortedFiles = [...input.filesTouched].sort((left, right) =>
    left.localeCompare(right)
  );
  const diffHash = sha256({
    patch: input.patch ?? null,
    replacements: input.replacements ?? null
  });
  const dependencyFiles = sortedFiles.filter(isDependencyFilePath);
  const dependencyImpact = {
    kind:
      dependencyFiles.length === 0
        ? ("none" as const)
        : ("dependency_files_touched" as const),
    files: dependencyFiles
  };
  const scaffoldProfile = codexDirectTaskScaffoldProfile(input.task);
  const scaffoldAppPatch =
    dependencyFiles.length === 0 &&
    scaffoldProfile !== undefined &&
    sortedFiles.length > 0 &&
    sortedFiles.every((file) =>
      isScaffoldAppOwnedPatchPath(file, scaffoldProfile.appOwnedPaths)
    );
  const riskClass =
    dependencyFiles.length > 0
      ? ("dependency_patch" as const)
      : scaffoldAppPatch
        ? ("scaffold_app_patch" as const)
        : ("workspace_patch" as const);
  const riskSummary =
    dependencyFiles.length > 0
      ? `Patch touches dependency files: ${dependencyFiles.join(", ")}.`
      : scaffoldAppPatch
        ? `Patch touches ${sortedFiles.length} app-owned scaffold file${sortedFiles.length === 1 ? "" : "s"} for ${scaffoldProfile.id}.`
        : `Patch touches ${sortedFiles.length} workspace file${sortedFiles.length === 1 ? "" : "s"} with no dependency file impact.`;
  const canonicalSignature = sha256({
    actionType: "filesystem.patch",
    cwd: input.cwd,
    filesTouched: sortedFiles,
    diffHash,
    riskClass
  });
  const approvalGrant =
    scaffoldAppPatch && scaffoldProfile !== undefined
      ? {
          mode: "scoped_until_expiry" as const,
          scope: `task:${input.task.id}:scaffold:${scaffoldProfile.id}:app_owned_patch`
        }
      : undefined;

  return {
    diffHash,
    riskClass,
    dependencyImpact,
    riskSummary,
    canonicalSignature,
    ...(approvalGrant === undefined ? {} : { approvalGrant })
  };
}
