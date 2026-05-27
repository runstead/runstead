import type { CodexDirectPatchApprovalMetadata } from "./patch-approval-metadata.js";
import {
  optionalParsedResumeContext,
  replacementArray,
  stringArray
} from "./patch-payload-parsers.js";
import type { CodexDirectPendingPatchPayload } from "./patch-payload-types.js";
import { isRecord } from "./tool-json.js";

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
