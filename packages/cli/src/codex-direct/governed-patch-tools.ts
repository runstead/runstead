import type { WorkerRun } from "@runstead/core";

import { applyWorkspacePatch } from "../codex-direct-native-tools.js";
import { runGovernedToolAction } from "../governed-action.js";
import {
  codexDirectPatchApprovalMetadata,
  codexDirectPatchFilesTouched,
  codexDirectPendingPatchPayload,
  type CodexDirectPendingToolResumeContext
} from "./patch-actions.js";
import { filesystemPatchAction, governedToolOptions } from "./policy-actions.js";
import type { CodexDirectWorkerOptions } from "./worker.js";

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
