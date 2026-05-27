import type { CodexDirectPatchApprovalMetadata } from "./patch-approval-metadata.js";
import { cloneCodexResponsesMessages } from "./codex-responses-input-items.js";
import type {
  CodexDirectPendingPatchPayload,
  CodexDirectPendingToolResumeContext
} from "./patch-payload-types.js";

export function codexDirectPendingPatchPayload(input: {
  filesTouched: string[];
  approvalMetadata: CodexDirectPatchApprovalMetadata;
  resumeContext?: CodexDirectPendingToolResumeContext;
  patch?: string;
  replacements?: {
    path: string;
    search: string;
    replace: string;
    replaceAll?: boolean;
  }[];
}): CodexDirectPendingPatchPayload {
  return {
    mode: input.patch === undefined ? "replacements" : "unified_diff",
    filesTouched: input.filesTouched,
    diffHash: input.approvalMetadata.diffHash,
    riskClass: input.approvalMetadata.riskClass,
    dependencyImpact: input.approvalMetadata.dependencyImpact,
    riskSummary: input.approvalMetadata.riskSummary,
    canonicalSignature: input.approvalMetadata.canonicalSignature,
    ...(input.resumeContext === undefined
      ? {}
      : {
          resumeContext: {
            messages: cloneCodexResponsesMessages(input.resumeContext.messages),
            toolCall: input.resumeContext.toolCall
          }
        }),
    ...(input.patch === undefined ? {} : { patch: input.patch }),
    ...(input.replacements === undefined ? {} : { replacements: input.replacements })
  };
}
