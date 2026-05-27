import type { WorkerRun } from "@runstead/core";

import {
  applyWorkspacePatch,
  type ApplyWorkspacePatchResult
} from "../codex-direct-native-tools.js";
import { runGovernedToolAction } from "../governed-action.js";
import { governedToolOptions } from "./policy-actions.js";
import type { CodexDirectPendingPatchResumeOptions } from "./worker-types.js";

export interface ApplyCodexDirectPendingPatchInput {
  options: CodexDirectPendingPatchResumeOptions;
  workerRun: WorkerRun;
}

export interface ApplyCodexDirectPendingPatchResult {
  value: ApplyWorkspacePatchResult;
  functionCallOutput: string;
}

export async function applyCodexDirectPendingPatch(
  input: ApplyCodexDirectPendingPatchInput
): Promise<ApplyCodexDirectPendingPatchResult> {
  const governed = await runGovernedToolAction({
    ...governedToolOptions({ ...input.options, workerRun: input.workerRun }),
    action: input.options.pendingPatch.action,
    run: async () => {
      const value = await applyWorkspacePatch(input.options.cwd, {
        ...(input.options.pendingPatch.pendingPatch.patch === undefined
          ? {}
          : { patch: input.options.pendingPatch.pendingPatch.patch }),
        ...(input.options.pendingPatch.pendingPatch.replacements === undefined
          ? {}
          : { replacements: input.options.pendingPatch.pendingPatch.replacements })
      });

      return {
        value,
        output: pendingPatchToolOutput(input.options, value)
      };
    }
  });

  return {
    value: governed.value,
    functionCallOutput: JSON.stringify(
      pendingPatchToolOutput(input.options, governed.value)
    )
  };
}

function pendingPatchToolOutput(
  options: CodexDirectPendingPatchResumeOptions,
  value: ApplyWorkspacePatchResult
): {
  mode: ApplyWorkspacePatchResult["mode"];
  filesTouched: string[];
  applied: boolean;
  approvalId: string;
  policyDecisionId: string;
  resume: "approved_pending_patch";
} {
  return {
    mode: value.mode,
    filesTouched: value.filesTouched,
    applied: value.applied,
    approvalId: options.pendingPatch.approvalId,
    policyDecisionId: options.pendingPatch.policyDecisionId,
    resume: "approved_pending_patch"
  };
}
