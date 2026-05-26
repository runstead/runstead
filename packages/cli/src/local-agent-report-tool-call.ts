import type { JsonObject } from "@runstead/core";

export type LocalAgentToolFailureKind =
  | "approval_required"
  | "policy_denied"
  | "harmless_patch_mismatch_retry"
  | "missing_file"
  | "tool_runtime_error"
  | "unknown";

export interface LocalAgentToolCallResource {
  resource?: string;
}

export interface LocalAgentToolCallSummary {
  summary?: string;
}

export interface LocalAgentToolCallFailureInsight {
  failureKind?: LocalAgentToolFailureKind;
  recoverable?: boolean;
  failureExplanation?: string;
}

export function parseJsonObject(value: unknown): JsonObject {
  if (typeof value !== "string" || value.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function toolCallResource(input: JsonObject): LocalAgentToolCallResource {
  const action = input.action;

  if (!isRecord(action) || !isRecord(action.resource)) {
    return {};
  }

  const path = action.resource.path;
  const id = action.resource.id;
  const type = action.resource.type;
  const value =
    typeof path === "string"
      ? path
      : typeof id === "string"
        ? id
        : typeof type === "string"
          ? type
          : undefined;

  return value === undefined ? {} : { resource: value };
}

export function toolCallSummary(input: JsonObject): LocalAgentToolCallSummary {
  const summary = input.summary;

  return typeof summary === "string" && summary.length > 0 ? { summary } : {};
}

export function toolCallFailureInsight(input: {
  actionType: string;
  status: string;
  output: JsonObject;
}): LocalAgentToolCallFailureInsight {
  if (input.status === "completed") {
    return {};
  }

  if (input.status === "approval_required") {
    return {
      failureKind: "approval_required",
      recoverable: true,
      failureExplanation:
        "Tool execution is paused for human approval; approve or deny the request, then resume the task."
    };
  }

  if (input.status === "denied") {
    return {
      failureKind: "policy_denied",
      recoverable: false,
      failureExplanation:
        "Runstead policy denied the action; change the task scope or policy before retrying."
    };
  }

  const message = toolCallFailureMessage(input.output).toLowerCase();

  if (
    input.actionType === "filesystem.patch" &&
    (message.includes("replacement search text not found") ||
      message.includes("replacement search text is ambiguous") ||
      message.includes("patch does not apply"))
  ) {
    return {
      failureKind: "harmless_patch_mismatch_retry",
      recoverable: true,
      failureExplanation:
        "Patch did not match current file contents; reread the file and retry with a narrower patch."
    };
  }

  if (
    message.includes("enoent") ||
    message.includes("no such file or directory") ||
    message.includes("not found")
  ) {
    return {
      failureKind: "missing_file",
      recoverable: true,
      failureExplanation:
        "The requested file or path was absent; this is usually recoverable by listing files or choosing a current path."
    };
  }

  if (message.length > 0) {
    return {
      failureKind: "tool_runtime_error",
      recoverable: true,
      failureExplanation:
        "The tool failed during execution; inspect the error, adjust the request, and retry if the task still needs it."
    };
  }

  return {
    failureKind: "unknown",
    recoverable: false,
    failureExplanation:
      "Runstead recorded a non-completed tool call without a structured error message."
  };
}

function toolCallFailureMessage(output: JsonObject): string {
  const error = output.error;
  const reason = output.reason;

  if (typeof error === "string") {
    return error;
  }

  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  if (typeof reason === "string") {
    return reason;
  }

  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
