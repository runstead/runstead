import type { ActionEnvelope } from "../policy.js";
import type { CodexDirectPatchApprovalMetadata } from "./patch-approval-metadata.js";
import {
  cloneCodexResponsesMessages,
  optionalParsedResumeContext,
  replacementArray,
  stringArray
} from "./patch-payload-parsers.js";
import type {
  ActionEnvelopeWithPendingPatch,
  CodexDirectPendingPatchPayload,
  CodexDirectPendingToolResumeContext
} from "./patch-payload-types.js";
import { isRecord } from "./tool-json.js";

export {
  cloneCodexResponsesMessages,
  optionalParsedResumeContext,
  parseCodexDirectPendingToolResumeContext,
  parseCodexResponsesFunctionCallInputItem,
  parseCodexResponsesInputItem,
  parseCodexResponsesInputItems,
  stringArray
} from "./patch-payload-parsers.js";
export type {
  ActionEnvelopeWithPendingPatch,
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

export function parsePendingPatchAction(
  actionJson: string
): ActionEnvelopeWithPendingPatch | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(actionJson) as unknown;
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || parsed.actionType !== "filesystem.patch") {
    return undefined;
  }

  const context = isRecord(parsed.context) ? parsed.context : undefined;
  const pendingPatch = parseCodexDirectPendingPatchPayload(context?.pendingPatch);

  if (
    typeof parsed.actionId !== "string" ||
    typeof parsed.actionType !== "string" ||
    pendingPatch === undefined
  ) {
    return undefined;
  }

  let resource: ActionEnvelope["resource"];

  if (isRecord(parsed.resource)) {
    if (typeof parsed.resource.type !== "string") {
      return undefined;
    }

    resource = {
      type: parsed.resource.type,
      ...(typeof parsed.resource.id === "string" ? { id: parsed.resource.id } : {}),
      ...(typeof parsed.resource.path === "string"
        ? { path: parsed.resource.path }
        : {})
    };
  }

  return {
    actionId: parsed.actionId,
    actionType: parsed.actionType,
    ...(resource === undefined ? {} : { resource }),
    context: {
      ...(context ?? {}),
      pendingPatch
    }
  };
}

export function parseCodexDirectPendingPatchPayload(
  value: unknown
): CodexDirectPendingPatchPayload | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const mode = value.mode;
  const dependencyImpact = isRecord(value.dependencyImpact)
    ? value.dependencyImpact
    : undefined;
  const filesTouched = stringArray(value.filesTouched);
  const dependencyFiles = stringArray(dependencyImpact?.files);

  if (
    (mode !== "unified_diff" && mode !== "replacements") ||
    filesTouched === undefined ||
    dependencyImpact === undefined ||
    dependencyFiles === undefined ||
    typeof dependencyImpact.kind !== "string" ||
    typeof value.diffHash !== "string" ||
    typeof value.riskClass !== "string" ||
    typeof value.riskSummary !== "string" ||
    typeof value.canonicalSignature !== "string"
  ) {
    return undefined;
  }

  if (mode === "unified_diff") {
    return typeof value.patch === "string"
      ? {
          mode,
          filesTouched,
          diffHash: value.diffHash,
          riskClass: normalizePendingPatchRiskClass(value.riskClass),
          dependencyImpact: {
            kind:
              dependencyImpact.kind === "dependency_files_touched"
                ? "dependency_files_touched"
                : "none",
            files: dependencyFiles
          },
          riskSummary: value.riskSummary,
          canonicalSignature: value.canonicalSignature,
          ...optionalParsedResumeContext(value.resumeContext),
          patch: value.patch
        }
      : undefined;
  }

  const replacements = replacementArray(value.replacements);

  return replacements === undefined
    ? undefined
    : {
        mode,
        filesTouched,
        diffHash: value.diffHash,
        riskClass: normalizePendingPatchRiskClass(value.riskClass),
        dependencyImpact: {
          kind:
            dependencyImpact.kind === "dependency_files_touched"
              ? "dependency_files_touched"
              : "none",
          files: dependencyFiles
        },
        riskSummary: value.riskSummary,
        canonicalSignature: value.canonicalSignature,
        ...optionalParsedResumeContext(value.resumeContext),
        replacements
      };
}

function normalizePendingPatchRiskClass(
  value: string
): CodexDirectPatchApprovalMetadata["riskClass"] {
  if (value === "dependency_patch" || value === "scaffold_app_patch") {
    return value;
  }

  return "workspace_patch";
}
