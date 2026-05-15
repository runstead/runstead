import { DEFAULT_CODEX_BASE_URL } from "./codex-auth.js";

export interface CodexResponsesTransportOptions {
  baseUrl?: string;
  accessToken: string;
  fetch?: FetchLike;
}

export interface CodexResponsesRequest {
  model: string;
  instructions: string;
  input: CodexResponsesInputItem[];
  tools?: CodexResponsesTool[];
  sessionId?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  maxOutputTokens?: number;
}

export type CodexResponsesInputItem =
  | CodexResponsesMessageInputItem
  | CodexResponsesFunctionCallInputItem
  | CodexResponsesFunctionCallOutputInputItem;

export interface CodexResponsesMessageInputItem {
  role: "user" | "assistant";
  content: string;
}

export interface CodexResponsesFunctionCallInputItem {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

export interface CodexResponsesFunctionCallOutputInputItem {
  type: "function_call_output";
  call_id: string;
  output: string;
}

export interface CodexResponsesTool {
  type: "function";
  name: string;
  description: string;
  strict: boolean;
  parameters: Record<string, unknown>;
}

export interface CodexResponsesToolCall {
  id: string;
  name: string;
  arguments: string;
  responseItemId?: string;
}

export interface CodexResponsesResult {
  id?: string;
  status?: string;
  outputText: string;
  toolCalls: CodexResponsesToolCall[];
  finishReason: "stop" | "tool_calls" | "incomplete";
  outputItems: unknown[];
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class CodexResponsesTransport {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly fetch: FetchLike;

  constructor(options: CodexResponsesTransportOptions) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_CODEX_BASE_URL);
    this.accessToken = options.accessToken;
    this.fetch = options.fetch ?? fetch;
  }

  async createResponse(request: CodexResponsesRequest): Promise<CodexResponsesResult> {
    const payload = buildCodexResponsesPayload(request);
    const response = await this.fetch(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...codexSessionHeaders(request.sessionId)
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Codex Responses request failed with status ${response.status}`);
    }

    return normalizeCodexResponsesPayload(await response.json());
  }
}

export function buildCodexResponsesPayload(
  request: CodexResponsesRequest
): Record<string, unknown> {
  if (request.model.trim().length === 0) {
    throw new Error("Codex Responses request model is required");
  }

  return {
    model: request.model.trim(),
    instructions: request.instructions,
    input: normalizeInputItems(request.input),
    store: false,
    tool_choice: request.tools === undefined ? "none" : "auto",
    parallel_tool_calls: request.tools !== undefined,
    ...(request.tools === undefined ? {} : { tools: normalizeTools(request.tools) }),
    reasoning: {
      effort: normalizeReasoningEffort(request.reasoningEffort),
      summary: "auto"
    },
    include: ["reasoning.encrypted_content"],
    ...(request.maxOutputTokens === undefined
      ? {}
      : { max_output_tokens: request.maxOutputTokens })
  };
}

export function normalizeCodexResponsesPayload(payload: unknown): CodexResponsesResult {
  if (!isRecord(payload)) {
    throw new Error("Codex Responses payload was not an object");
  }

  const outputItems = Array.isArray(payload.output) ? payload.output : [];

  if (outputItems.length === 0 && typeof payload.output_text !== "string") {
    throw new Error("Codex Responses payload returned no output items");
  }

  const textParts: string[] = [];
  const toolCalls: CodexResponsesToolCall[] = [];
  let hasIncomplete = payload.status === "queued" || payload.status === "in_progress";

  for (const item of outputItems) {
    if (!isRecord(item)) {
      continue;
    }

    if (item.status === "queued" || item.status === "in_progress") {
      hasIncomplete = true;
    }

    if (item.type === "message") {
      textParts.push(extractOutputText(item.content));
      continue;
    }

    if (item.type === "function_call" || item.type === "custom_tool_call") {
      const name = item.name;
      const rawArguments =
        item.type === "custom_tool_call" ? item.input : item.arguments;

      if (typeof name !== "string" || name.trim().length === 0) {
        continue;
      }

      const callId =
        typeof item.call_id === "string" && item.call_id.trim().length > 0
          ? item.call_id.trim()
          : typeof item.id === "string" && item.id.trim().length > 0
            ? item.id.trim()
            : `call_${toolCalls.length + 1}`;
      const responseItemId =
        typeof item.id === "string" && item.id.trim().length > 0
          ? item.id.trim()
          : undefined;

      toolCalls.push({
        id: callId,
        name: name.trim(),
        arguments:
          typeof rawArguments === "string"
            ? rawArguments
            : JSON.stringify(rawArguments ?? {}),
        ...(responseItemId === undefined ? {} : { responseItemId })
      });
    }
  }

  const outputText =
    textParts.filter(Boolean).join("\n").trim() ||
    (typeof payload.output_text === "string" ? payload.output_text.trim() : "");

  return {
    ...(typeof payload.id === "string" ? { id: payload.id } : {}),
    ...(typeof payload.status === "string" ? { status: payload.status } : {}),
    outputText,
    toolCalls,
    finishReason:
      toolCalls.length > 0 ? "tool_calls" : hasIncomplete ? "incomplete" : "stop",
    outputItems
  };
}

function normalizeInputItems(
  input: CodexResponsesInputItem[]
): CodexResponsesInputItem[] {
  return input.map((item) => {
    if ("role" in item) {
      return {
        role: item.role,
        content: item.content
      };
    }

    if (item.type === "function_call") {
      return {
        type: "function_call",
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments
      };
    }

    return {
      type: "function_call_output",
      call_id: item.call_id,
      output: item.output
    };
  });
}

function normalizeTools(tools: CodexResponsesTool[]): CodexResponsesTool[] {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    strict: tool.strict,
    parameters: tool.parameters
  }));
}

function normalizeReasoningEffort(
  effort: CodexResponsesRequest["reasoningEffort"]
): "low" | "medium" | "high" {
  if (effort === "xhigh") {
    return "high";
  }

  return effort ?? "medium";
}

function codexSessionHeaders(sessionId: string | undefined): Record<string, string> {
  if (sessionId === undefined || sessionId.trim().length === 0) {
    return {};
  }

  return {
    session_id: sessionId.trim(),
    "x-client-request-id": sessionId.trim()
  };
}

function extractOutputText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((part) => {
      if (!isRecord(part)) {
        return [];
      }

      if (
        (part.type === "output_text" || part.type === "text") &&
        typeof part.text === "string"
      ) {
        return [part.text];
      }

      return [];
    })
    .join("")
    .trim();
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
