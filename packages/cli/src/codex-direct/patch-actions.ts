import { createHash } from "node:crypto";

import type { Task } from "@runstead/core";
import type { ActionEnvelope } from "../policy.js";
import { matchesPolicyPathPattern } from "../policy.js";
import type {
  CodexResponsesFunctionCallInputItem,
  CodexResponsesInputItem
} from "../codex-responses-transport.js";
import { inferWorkspacePatchTouchedFiles } from "../codex-direct-native-tools.js";
import { isRecord } from "./tool-arguments.js";

const DEPENDENCY_FILE_NAMES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb"
]);

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

export interface CodexDirectTaskScaffoldProfile {
  id: string;
  appOwnedPaths: string[];
}

const SCAFFOLD_APP_PATCH_PROTECTED_PATH_PATTERNS = [
  ".env",
  ".env.*",
  "**/secrets/**",
  ".git/**",
  ".runstead/**",
  "infra/prod/**",
  "node_modules/**",
  "dist/**",
  "build/**"
];

export function codexDirectTaskScaffoldProfile(
  task: Task
): CodexDirectTaskScaffoldProfile | undefined {
  const profile = task.input.scaffoldProfile;

  if (!isRecord(profile) || typeof profile.id !== "string") {
    return undefined;
  }

  const appOwnedPaths = stringArray(profile.appOwnedPaths);

  if (appOwnedPaths === undefined || appOwnedPaths.length === 0) {
    return undefined;
  }

  return {
    id: profile.id,
    appOwnedPaths
  };
}

export function isScaffoldAppOwnedPatchPath(
  path: string,
  appOwnedPaths: string[]
): boolean {
  if (
    SCAFFOLD_APP_PATCH_PROTECTED_PATH_PATTERNS.some((pattern) =>
      matchesPolicyPathPattern(path, pattern)
    )
  ) {
    return false;
  }

  return appOwnedPaths.some((pattern) => matchesPolicyPathPattern(path, pattern));
}

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

export interface CodexDirectPendingToolResumeContext {
  messages: CodexResponsesInputItem[];
  toolCall: CodexResponsesFunctionCallInputItem;
}

export type ActionEnvelopeWithPendingPatch = ActionEnvelope & {
  context: NonNullable<ActionEnvelope["context"]> & {
    pendingPatch: CodexDirectPendingPatchPayload;
  };
};

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

export function optionalParsedResumeContext(
  value: unknown
): { resumeContext: CodexDirectPendingToolResumeContext } | object {
  const resumeContext = parseCodexDirectPendingToolResumeContext(value);

  return resumeContext === undefined ? {} : { resumeContext };
}

export function parseCodexDirectPendingToolResumeContext(
  value: unknown
): CodexDirectPendingToolResumeContext | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const messages = parseCodexResponsesInputItems(value.messages);
  const toolCall = parseCodexResponsesFunctionCallInputItem(value.toolCall);

  return messages === undefined || toolCall === undefined
    ? undefined
    : { messages, toolCall };
}

export function cloneCodexResponsesMessages(
  messages: CodexResponsesInputItem[]
): CodexResponsesInputItem[] {
  return messages.map((item) => ({ ...item }));
}

export function parseCodexResponsesInputItems(
  value: unknown
): CodexResponsesInputItem[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parsed = value.map(parseCodexResponsesInputItem);

  return parsed.every((item): item is CodexResponsesInputItem => item !== undefined)
    ? parsed
    : undefined;
}

export function parseCodexResponsesInputItem(
  value: unknown
): CodexResponsesInputItem | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string"
  ) {
    return {
      role: value.role,
      content: value.content
    };
  }

  if (value.type === "function_call") {
    return parseCodexResponsesFunctionCallInputItem(value);
  }

  if (
    value.type === "function_call_output" &&
    typeof value.call_id === "string" &&
    typeof value.output === "string"
  ) {
    return {
      type: "function_call_output",
      call_id: value.call_id,
      output: value.output
    };
  }

  return undefined;
}

export function parseCodexResponsesFunctionCallInputItem(
  value: unknown
): CodexResponsesFunctionCallInputItem | undefined {
  if (
    !isRecord(value) ||
    value.type !== "function_call" ||
    typeof value.call_id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.arguments !== "string"
  ) {
    return undefined;
  }

  return {
    type: "function_call",
    call_id: value.call_id,
    name: value.name,
    arguments: value.arguments
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

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0
  );

  return strings.length === value.length ? strings : undefined;
}

function replacementArray(
  value: unknown
): CodexDirectPendingPatchPayload["replacements"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const replacements: NonNullable<CodexDirectPendingPatchPayload["replacements"]> = [];

  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.path !== "string" ||
      typeof item.search !== "string" ||
      typeof item.replace !== "string"
    ) {
      return undefined;
    }

    replacements.push({
      path: item.path,
      search: item.search,
      replace: item.replace,
      ...(item.replaceAll === undefined ? {} : { replaceAll: item.replaceAll === true })
    });
  }

  return replacements;
}

export function isDependencyFilePath(path: string): boolean {
  const fileName = path.split("/").pop() ?? path;

  return DEPENDENCY_FILE_NAMES.has(fileName);
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
