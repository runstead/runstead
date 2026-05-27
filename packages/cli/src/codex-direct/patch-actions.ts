import { inferWorkspacePatchTouchedFiles } from "../codex-direct-native-tools.js";

export {
  cloneCodexResponsesMessages,
  codexDirectPendingPatchPayload,
  optionalParsedResumeContext,
  parseCodexDirectPendingPatchPayload,
  parseCodexDirectPendingToolResumeContext,
  parseCodexResponsesFunctionCallInputItem,
  parseCodexResponsesInputItem,
  parseCodexResponsesInputItems,
  parsePendingPatchAction
} from "./patch-payload.js";
export type {
  ActionEnvelopeWithPendingPatch,
  CodexDirectPendingPatchPayload,
  CodexDirectPendingToolResumeContext
} from "./patch-payload.js";
export {
  codexDirectTaskScaffoldProfile,
  isScaffoldAppOwnedPatchPath,
  type CodexDirectTaskScaffoldProfile
} from "./patch-scaffold-profile.js";
export {
  codexDirectPatchApprovalMetadata,
  type CodexDirectPatchApprovalMetadata
} from "./patch-approval-metadata.js";
export { isDependencyFilePath } from "./patch-dependency-files.js";
export { sha256 } from "./patch-hash.js";

export function codexDirectPatchFilesTouched(input: {
  patch?: string;
  replacements?: {
    path: string;
    search: string;
    replace: string;
    replaceAll?: boolean;
  }[];
}): string[] {
  return inferWorkspacePatchTouchedFiles(input);
}
