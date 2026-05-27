import type { ActionEnvelope } from "../policy.js";
import type {
  CodexResponsesFunctionCallInputItem,
  CodexResponsesInputItem
} from "../codex-responses-transport.js";
import type { CodexDirectPatchApprovalMetadata } from "./patch-approval-metadata.js";

export interface CodexDirectPendingToolResumeContext {
  messages: CodexResponsesInputItem[];
  toolCall: CodexResponsesFunctionCallInputItem;
}

export interface CodexDirectPendingPatchPayload extends CodexDirectPatchApprovalMetadata {
  mode: "unified_diff" | "replacements";
  filesTouched: string[];
  resumeContext?: CodexDirectPendingToolResumeContext;
  patch?: string;
  replacements?: {
    path: string;
    search: string;
    replace: string;
    replaceAll?: boolean;
  }[];
}

export type ActionEnvelopeWithPendingPatch = ActionEnvelope & {
  context: NonNullable<ActionEnvelope["context"]> & {
    pendingPatch: CodexDirectPendingPatchPayload;
  };
};
