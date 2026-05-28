import { extractAnthropicMessagesToolCalls } from "@runstead/runtime";

import type {
  CodexResponsesInputItem,
  CodexResponsesRequest,
  CodexResponsesResult,
  CodexResponsesTool
} from "./codex-responses-transport.js";

export interface AnthropicMessagesTransportOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: FetchLike;
  version?: string;
}

export class AnthropicMessagesTransport {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetch: FetchLike;
  readonly version: string;

  constructor(options: AnthropicMessagesTransportOptions) {
    this.baseUrl = trimTrailingSlash(options.baseUrl);
    this.apiKey = options.apiKey.trim();
    this.fetch = options.fetch ?? fetch;
    this.version = options.version ?? "2023-06-01";
  }

  async createResponse(request: CodexResponsesRequest): Promise<CodexResponsesResult> {
    const response = await this.fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "anthropic-version": this.version,
        "x-api-key": this.apiKey
      },
      body: JSON.stringify(buildAnthropicMessagesPayload(request))
    });

    if (!response.ok) {
      throw new Error(
        `Anthropic Messages request failed with status ${response.status}`
      );
    }

    return normalizeAnthropicMessagesPayload(await response.json());
  }
}

export function buildAnthropicMessagesPayload(
  request: CodexResponsesRequest
): Record<string, unknown> {
  if (request.model.trim().length === 0) {
    throw new Error("Anthropic Messages request model is required");
  }

  return {
    model: request.model.trim(),
    system: request.instructions,
    messages: buildAnthropicMessages(request.input),
    max_tokens: request.maxOutputTokens ?? 4096,
    ...(request.tools === undefined ? {} : { tools: request.tools.map(anthropicTool) })
  };
}

export function normalizeAnthropicMessagesPayload(
  payload: unknown
): CodexResponsesResult {
  if (!isRecord(payload)) {
    throw new Error("Anthropic Messages payload was not an object");
  }

  const content = Array.isArray(payload.content) ? payload.content : [];
  const textParts: string[] = [];
  const toolCalls = extractAnthropicMessagesToolCalls(payload).map((call) => ({
    id: call.id,
    name: call.name,
    arguments: call.rawArguments
  }));

  for (const item of content) {
    if (!isRecord(item)) {
      continue;
    }

    if (item.type === "text" && typeof item.text === "string") {
      textParts.push(item.text);
      continue;
    }
  }

  return {
    ...(typeof payload.id === "string" ? { id: payload.id } : {}),
    ...(typeof payload.stop_reason === "string" ? { status: payload.stop_reason } : {}),
    outputText: textParts.join("\n").trim(),
    toolCalls,
    finishReason:
      toolCalls.length > 0
        ? "tool_calls"
        : payload.stop_reason === "max_tokens"
          ? "incomplete"
          : "stop",
    outputItems: content
  };
}

function buildAnthropicMessages(
  input: CodexResponsesInputItem[]
): Record<string, unknown>[] {
  return input.map((item) => {
    if ("role" in item) {
      return {
        role: item.role,
        content: item.content
      };
    }

    if (item.type === "function_call") {
      return {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: item.call_id,
            name: item.name,
            input: parseJsonObject(item.arguments)
          }
        ]
      };
    }

    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: item.call_id,
          content: item.output
        }
      ]
    };
  });
}

function anthropicTool(tool: CodexResponsesTool): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
  };
}

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
