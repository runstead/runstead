import type { ActionEnvelope } from "../policy.js";
import type {
  CodexDirectPatchApprovalMetadata,
  CodexDirectPendingPatchPayload
} from "./patch-actions.js";
import { stableActionId } from "./tool-action-id.js";

export function filesystemPatchAction(input: {
  cwd: string;
  filesTouched: string[];
  approvalMetadata: CodexDirectPatchApprovalMetadata;
  pendingPatch: CodexDirectPendingPatchPayload;
  stableParts: unknown[];
}): ActionEnvelope {
  return {
    actionId: stableActionId("filesystem.patch", input.stableParts),
    actionType: "filesystem.patch",
    resource: {
      type: "file",
      path: input.filesTouched[0] ?? "."
    },
    context: {
      cwd: input.cwd,
      filesTouched: input.filesTouched,
      diffHash: input.approvalMetadata.diffHash,
      riskClass: input.approvalMetadata.riskClass,
      dependencyImpact: input.approvalMetadata.dependencyImpact,
      riskSummary: input.approvalMetadata.riskSummary,
      canonicalSignature: input.approvalMetadata.canonicalSignature,
      ...(input.approvalMetadata.approvalGrant === undefined
        ? {}
        : { approvalGrant: input.approvalMetadata.approvalGrant }),
      pendingPatch: input.pendingPatch,
      sideEffects: ["write_workspace"]
    }
  };
}
