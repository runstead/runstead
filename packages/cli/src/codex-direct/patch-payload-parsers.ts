import type {
  CodexResponsesFunctionCallInputItem,
  CodexResponsesInputItem
} from "../codex-responses-transport.js";
import { isRecord } from "./tool-arguments.js";
import type {
  CodexDirectPendingPatchPayload,
  CodexDirectPendingToolResumeContext
} from "./patch-payload.js";

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

export function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0
  );

  return strings.length === value.length ? strings : undefined;
}

export function replacementArray(
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
