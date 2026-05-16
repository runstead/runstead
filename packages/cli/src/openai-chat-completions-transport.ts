import type {
  CodexResponsesInputItem,
  CodexResponsesRequest,
  CodexResponsesResult,
  CodexResponsesTool,
  CodexResponsesToolCall
} from "./codex-responses-transport.js";

export interface OpenAiChatCompletionsTransportOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: FetchLike;
  headers?: Record<string, string>;
}

export class OpenAiChatCompletionsTransport {
  readonly baseUrl: string;
  readonly apiKey: string | undefined;
  readonly fetch: FetchLike;
  readonly headers: Record<string, string>;

  constructor(options: OpenAiChatCompletionsTransportOptions) {
    this.baseUrl = trimTrailingSlash(options.baseUrl);
    this.apiKey = normalizeString(options.apiKey);
    this.fetch = options.fetch ?? fetch;
    this.headers = options.headers ?? {};
  }

  async createResponse(request: CodexResponsesRequest): Promise<CodexResponsesResult> {
    const response = await this.fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(this.apiKey === undefined
          ? {}
          : { Authorization: `Bearer ${this.apiKey}` }),
        ...this.headers
      },
      body: JSON.stringify(buildOpenAiChatCompletionsPayload(request))
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI-compatible chat completions request failed with status ${response.status}`
      );
    }

    return normalizeOpenAiChatCompletionsPayload(await response.json());
  }
}

export function buildOpenAiChatCompletionsPayload(
  request: CodexResponsesRequest
): Record<string, unknown> {
  if (request.model.trim().length === 0) {
    throw new Error("OpenAI-compatible request model is required");
  }

  return {
    model: request.model.trim(),
    messages: buildOpenAiMessages(request.instructions, request.input),
    stream: false,
    ...(request.tools === undefined
      ? {}
      : {
          tools: request.tools.map(openAiTool),
          tool_choice: "auto",
          parallel_tool_calls: true
        }),
    ...(request.maxOutputTokens === undefined
      ? {}
      : { max_tokens: request.maxOutputTokens })
  };
}

export function normalizeOpenAiChatCompletionsPayload(
  payload: unknown
): CodexResponsesResult {
  if (!isRecord(payload)) {
    throw new Error("OpenAI-compatible response payload was not an object");
  }

  const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;

  if (!isRecord(choice) || !isRecord(choice.message)) {
    throw new Error("OpenAI-compatible response payload returned no message");
  }

  const message = choice.message;
  const outputText = openAiContentText(message.content);
  const toolCalls = openAiToolCalls(message.tool_calls);

  return {
    ...(typeof payload.id === "string" ? { id: payload.id } : {}),
    ...(typeof choice.finish_reason === "string"
      ? { status: choice.finish_reason }
      : {}),
    outputText,
    toolCalls,
    finishReason:
      toolCalls.length > 0
        ? "tool_calls"
        : choice.finish_reason === "length"
          ? "incomplete"
          : "stop",
    outputItems: [message]
  };
}

function buildOpenAiMessages(
  instructions: string,
  input: CodexResponsesInputItem[]
): Record<string, unknown>[] {
  return [
    {
      role: "system",
      content: instructions
    },
    ...input.map((item) => {
      if ("role" in item) {
        return {
          role: item.role,
          content: item.content
        };
      }

      if (item.type === "function_call") {
        return {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: item.call_id,
              type: "function",
              function: {
                name: item.name,
                arguments: item.arguments
              }
            }
          ]
        };
      }

      return {
        role: "tool",
        tool_call_id: item.call_id,
        content: item.output
      };
    })
  ];
}

function openAiTool(tool: CodexResponsesTool): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  };
}

function openAiToolCalls(value: unknown): CodexResponsesToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item, index) => {
    if (!isRecord(item) || !isRecord(item.function)) {
      return [];
    }

    const name = item.function.name;

    if (typeof name !== "string" || name.trim().length === 0) {
      return [];
    }

    return [
      {
        id: stringValue(item.id) ?? `call_${index + 1}`,
        name: name.trim(),
        arguments:
          typeof item.function.arguments === "string"
            ? item.function.arguments
            : JSON.stringify(item.function.arguments ?? {})
      }
    ];
  });
}

function openAiContentText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((part) => {
      if (!isRecord(part)) {
        return [];
      }

      return typeof part.text === "string" ? [part.text] : [];
    })
    .join("")
    .trim();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizeString(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value.trim();
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
