import type {
  CodexResponsesFunctionCallInputItem,
  CodexResponsesInputItem
} from "../codex-responses-transport.js";
import { isRecord } from "./tool-json.js";

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
