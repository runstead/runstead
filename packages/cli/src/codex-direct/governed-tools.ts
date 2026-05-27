import type { WorkerRun } from "@runstead/core";

import { applyWorkspacePatch } from "../codex-direct-native-tools.js";
import { runGovernedToolAction } from "../governed-action.js";
import type { CodexDirectWorkerOptions } from "./worker.js";
import { governedToolOptions } from "./policy-actions.js";
import { filesystemPatchAction } from "./policy-actions.js";
import {
  codexDirectPatchApprovalMetadata,
  codexDirectPatchFilesTouched,
  codexDirectPendingPatchPayload,
  type CodexDirectPendingToolResumeContext
} from "./patch-actions.js";

export {
  runGovernedDiffSummary,
  runGovernedGitLog,
  runGovernedGitRead,
  runGovernedGitShow
} from "./git-read-tools.js";

export {
  runGovernedFileInfo,
  runGovernedListFiles,
  runGovernedReadManyFiles,
  runGovernedTree
} from "./workspace-read-tools.js";
export {
  runGovernedReadEvidence,
  runGovernedWorkspaceFacts
} from "./governed-evidence-tools.js";
export { runGovernedShellCommand } from "./governed-shell-tools.js";
export { runGovernedVerifier } from "./governed-verifier-tools.js";
export { runGovernedPackageScripts } from "./workspace-metadata-tools.js";
export { runGovernedSearchText } from "./workspace-search-tools.js";

export async function runGovernedApplyPatch(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    resumeContext?: CodexDirectPendingToolResumeContext;
    patch?: string;
    replacements?: {
      path: string;
      search: string;
      replace: string;
      replaceAll?: boolean;
    }[];
  }
) {
  const filesTouched = codexDirectPatchFilesTouched(options);
  const approvalMetadata = codexDirectPatchApprovalMetadata({
    cwd: options.cwd,
    task: options.task,
    filesTouched,
    ...(options.patch === undefined ? {} : { patch: options.patch }),
    ...(options.replacements === undefined
      ? {}
      : { replacements: options.replacements })
  });

  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: filesystemPatchAction({
      cwd: options.cwd,
      filesTouched,
      approvalMetadata,
      pendingPatch: codexDirectPendingPatchPayload({
        filesTouched,
        approvalMetadata,
        ...(options.resumeContext === undefined
          ? {}
          : { resumeContext: options.resumeContext }),
        ...(options.patch === undefined ? {} : { patch: options.patch }),
        ...(options.replacements === undefined
          ? {}
          : { replacements: options.replacements })
      }),
      stableParts: [options.cwd, options.patch, options.replacements ?? []]
    }),
    run: async () => {
      const value = await applyWorkspacePatch(options.cwd, {
        ...(options.patch === undefined ? {} : { patch: options.patch }),
        ...(options.replacements === undefined
          ? {}
          : { replacements: options.replacements })
      });

      return {
        value,
        output: {
          mode: value.mode,
          filesTouched: value.filesTouched,
          applied: value.applied
        }
      };
    }
  }).then((result) => result.value);
}
