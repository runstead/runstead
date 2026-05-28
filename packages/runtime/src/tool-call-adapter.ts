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

export const anthropicMessagesToolCallAdapter: RuntimeToolCallAdapter<
  unknown,
  JsonObject
> = {
  provider: "anthropic_messages",
  extractToolCalls: extractAnthropicMessagesToolCalls,
  toolResultMessage: anthropicMessagesToolResultMessage
};

export const geminiGenerateContentToolCallAdapter: RuntimeToolCallAdapter<
  unknown,
  JsonObject
> = {
  provider: "gemini_generate_content",
  extractToolCalls: extractGeminiGenerateContentToolCalls,
  toolResultMessage: geminiGenerateContentToolResultMessage
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

export function extractAnthropicMessagesToolCalls(
  response: unknown
): RuntimeToolCall[] {
  const content =
    isRecord(response) && Array.isArray(response.content) ? response.content : [];
  const calls: RuntimeToolCall[] = [];

  for (const item of content) {
    if (!isRecord(item) || item.type !== "tool_use") {
      continue;
    }

    const name = stringValue(item.name);

    if (name === undefined) {
      continue;
    }

    const id = stringValue(item.id) ?? `call_${calls.length + 1}`;

    calls.push({
      id,
      name,
      ...runtimeToolArguments(item.input),
      provider: "anthropic_messages",
      responseItemId: id
    });
  }

  return calls;
}

export function extractGeminiGenerateContentToolCalls(
  response: unknown
): RuntimeToolCall[] {
  const candidates =
    isRecord(response) && Array.isArray(response.candidates) ? response.candidates : [];
  const candidate = isRecord(candidates[0]) ? candidates[0] : undefined;
  const content = isRecord(candidate?.content) ? candidate.content : undefined;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  const calls: RuntimeToolCall[] = [];

  for (const part of parts) {
    if (!isRecord(part) || !isRecord(part.functionCall)) {
      continue;
    }

    const name = stringValue(part.functionCall.name);

    if (name === undefined) {
      continue;
    }

    calls.push({
      id: stringValue(part.functionCall.id) ?? `call_${calls.length + 1}`,
      name,
      ...runtimeToolArguments(part.functionCall.args),
      provider: "gemini_generate_content"
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

export function anthropicMessagesToolResultMessage(
  result: RuntimeToolResult
): JsonObject {
  return {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: result.callId,
        content: runtimeToolResultText(result)
      }
    ]
  };
}

export function geminiGenerateContentToolResultMessage(
  result: RuntimeToolResult
): JsonObject {
  return {
    role: "user",
    parts: [
      {
        functionResponse: {
          name: result.name ?? "tool_result",
          response: runtimeToolResultObject(result)
        }
      }
    ]
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

function runtimeToolResultObject(result: RuntimeToolResult): JsonObject {
  const output =
    typeof result.output === "string" ? parseJsonObject(result.output) : result.output;

  if (result.isError === true) {
    return {
      error: output
    };
  }

  return isRecord(output) ? output : { output };
}

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
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
