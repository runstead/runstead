import type { JsonObject } from "@runstead/core";

export interface RuntimeToolCall {
  id: string;
  name: string;
  arguments: JsonObject;
  rawArguments: string;
  provider: string;
  responseItemId?: string;
}

export interface RuntimeToolResult {
  callId: string;
  name?: string;
  output: JsonObject | string;
  isError?: boolean;
}

export interface RuntimeToolCallAdapter<TResponse, TResultMessage> {
  provider: string;
  extractToolCalls(response: TResponse): RuntimeToolCall[];
  toolResultMessage(result: RuntimeToolResult): TResultMessage;
}

export const codexResponsesToolCallAdapter: RuntimeToolCallAdapter<
  unknown,
  JsonObject
> = {
  provider: "codex_responses",
  extractToolCalls: extractCodexResponsesToolCalls,
  toolResultMessage: codexResponsesToolResultMessage
};

export const openAiChatCompletionsToolCallAdapter: RuntimeToolCallAdapter<
  unknown,
  JsonObject
> = {
  provider: "openai_chat_completions",
  extractToolCalls: extractOpenAiChatCompletionsToolCalls,
  toolResultMessage: openAiChatCompletionsToolResultMessage
};

export function extractCodexResponsesToolCalls(response: unknown): RuntimeToolCall[] {
  const outputItems = Array.isArray(response)
    ? response
    : isRecord(response) && Array.isArray(response.output)
      ? response.output
      : [];
  const calls: RuntimeToolCall[] = [];

  for (const item of outputItems) {
    if (!isRecord(item)) {
      continue;
    }

    if (item.type !== "function_call" && item.type !== "custom_tool_call") {
      continue;
    }

    const name = stringValue(item.name);

    if (name === undefined) {
      continue;
    }

    const raw = item.type === "custom_tool_call" ? item.input : item.arguments;
    const id =
      stringValue(item.call_id) ?? stringValue(item.id) ?? `call_${calls.length + 1}`;
    const responseItemId = stringValue(item.id);

    calls.push({
      id,
      name,
      ...runtimeToolArguments(raw),
      provider: "codex_responses",
      ...(responseItemId === undefined ? {} : { responseItemId })
    });
  }

  return calls;
}

export function extractOpenAiChatCompletionsToolCalls(
  response: unknown
): RuntimeToolCall[] {
  const choices =
    isRecord(response) && Array.isArray(response.choices) ? response.choices : [];
  const message = isRecord(choices[0]) ? choices[0].message : undefined;
  const rawCalls =
    isRecord(message) && Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const calls: RuntimeToolCall[] = [];

  for (const rawCall of rawCalls) {
    if (!isRecord(rawCall) || !isRecord(rawCall.function)) {
      continue;
    }

    const name = stringValue(rawCall.function.name);

    if (name === undefined) {
      continue;
    }

    calls.push({
      id: stringValue(rawCall.id) ?? `call_${calls.length + 1}`,
      name,
      ...runtimeToolArguments(rawCall.function.arguments),
      provider: "openai_chat_completions"
    });
  }

  return calls;
}

export function codexResponsesToolResultMessage(result: RuntimeToolResult): JsonObject {
  return {
    type: "function_call_output",
    call_id: result.callId,
    output: runtimeToolResultText(result)
  };
}

export function openAiChatCompletionsToolResultMessage(
  result: RuntimeToolResult
): JsonObject {
  return {
    role: "tool",
    tool_call_id: result.callId,
    content: runtimeToolResultText(result)
  };
}

export function runtimeToolArguments(raw: unknown): {
  arguments: JsonObject;
  rawArguments: string;
} {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;

      return {
        arguments: isRecord(parsed) ? parsed : { value: parsed },
        rawArguments: raw
      };
    } catch {
      return {
        arguments: {},
        rawArguments: raw
      };
    }
  }

  return {
    arguments: isRecord(raw) ? raw : {},
    rawArguments: JSON.stringify(raw ?? {})
  };
}

function runtimeToolResultText(result: RuntimeToolResult): string {
  const output =
    typeof result.output === "string" ? result.output : JSON.stringify(result.output);

  return result.isError === true
    ? JSON.stringify({
        error: output
      })
    : output;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? undefined : trimmed;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
