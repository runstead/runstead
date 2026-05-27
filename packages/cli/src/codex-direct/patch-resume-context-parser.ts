import {
  parseCodexResponsesFunctionCallInputItem,
  parseCodexResponsesInputItems
} from "./codex-responses-input-items.js";
import type { CodexDirectPendingToolResumeContext } from "./patch-payload-types.js";
import { isRecord } from "./tool-json.js";

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
