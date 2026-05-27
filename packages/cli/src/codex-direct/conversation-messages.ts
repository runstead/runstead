import type {
  CodexResponsesFunctionCallInputItem,
  CodexResponsesInputItem,
  CodexResponsesRequest,
  CodexResponsesToolCall
} from "../codex-responses-transport.js";
import type { CodexDirectWorkerOptions } from "./worker.js";
import {
  buildCodexDirectInstructions,
  codexDirectToolDefinitions
} from "./tool-definitions.js";

export function codexDirectConversationRequest(input: {
  options: CodexDirectWorkerOptions;
  messages: CodexResponsesInputItem[];
}): CodexResponsesRequest {
  return {
    model: input.options.model,
    instructions: buildCodexDirectInstructions(input.options),
    input: input.messages,
    tools: codexDirectToolDefinitions(),
    sessionId: input.options.task.id
  };
}

export function codexDirectFunctionCallInput(
  toolCall: CodexResponsesToolCall
): CodexResponsesFunctionCallInputItem {
  return {
    type: "function_call",
    call_id: toolCall.id,
    name: toolCall.name,
    arguments: toolCall.arguments
  };
}

export function appendCodexDirectToolExchange(input: {
  messages: CodexResponsesInputItem[];
  toolCall: CodexResponsesToolCall;
  output: string;
}): void {
  input.messages.push(codexDirectFunctionCallInput(input.toolCall));
  input.messages.push({
    type: "function_call_output",
    call_id: input.toolCall.id,
    output: input.output
  });
}
