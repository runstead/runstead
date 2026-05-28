import { extractGeminiGenerateContentToolCalls } from "@runstead/runtime";

import type {
  CodexResponsesInputItem,
  CodexResponsesRequest,
  CodexResponsesResult,
  CodexResponsesTool
} from "./codex-responses-transport.js";

export interface GeminiGenerateContentTransportOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: FetchLike;
}

export class GeminiGenerateContentTransport {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetch: FetchLike;

  constructor(options: GeminiGenerateContentTransportOptions) {
    this.baseUrl = trimTrailingSlash(options.baseUrl);
    this.apiKey = options.apiKey.trim();
    this.fetch = options.fetch ?? fetch;
  }

  async createResponse(request: CodexResponsesRequest): Promise<CodexResponsesResult> {
    const response = await this.fetch(
      geminiGenerateContentUrl(this.baseUrl, request.model, this.apiKey),
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey
        },
        body: JSON.stringify(buildGeminiGenerateContentPayload(request))
      }
    );

    if (!response.ok) {
      throw new Error(
        `Gemini generateContent request failed with status ${response.status}`
      );
    }

    return normalizeGeminiGenerateContentPayload(await response.json());
  }
}

export function buildGeminiGenerateContentPayload(
  request: CodexResponsesRequest
): Record<string, unknown> {
  if (request.model.trim().length === 0) {
    throw new Error("Gemini generateContent request model is required");
  }

  return {
    systemInstruction: {
      parts: [{ text: request.instructions }]
    },
    contents: buildGeminiContents(request.input),
    ...(request.tools === undefined
      ? {}
      : {
          tools: [
            {
              functionDeclarations: request.tools.map(geminiTool)
            }
          ]
        }),
    ...(request.maxOutputTokens === undefined
      ? {}
      : {
          generationConfig: {
            maxOutputTokens: request.maxOutputTokens
          }
        })
  };
}

export function normalizeGeminiGenerateContentPayload(
  payload: unknown
): CodexResponsesResult {
  if (!isRecord(payload)) {
    throw new Error("Gemini generateContent payload was not an object");
  }

  const candidates = payload.candidates;
  const candidate = Array.isArray(candidates)
    ? (candidates as unknown[])[0]
    : undefined;

  if (!isRecord(candidate) || !isRecord(candidate.content)) {
    throw new Error("Gemini generateContent payload returned no candidate content");
  }

  const parts = Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const textParts: string[] = [];
  const toolCalls = extractGeminiGenerateContentToolCalls(payload).map((call) => ({
    id: call.id,
    name: call.name,
    arguments: call.rawArguments
  }));

  for (const part of parts) {
    if (!isRecord(part)) {
      continue;
    }

    if (typeof part.text === "string") {
      textParts.push(part.text);
    }
  }

  return {
    outputText: textParts.join("\n").trim(),
    toolCalls,
    finishReason:
      toolCalls.length > 0
        ? "tool_calls"
        : candidate.finishReason === "MAX_TOKENS"
          ? "incomplete"
          : "stop",
    ...(typeof candidate.finishReason === "string"
      ? { status: candidate.finishReason }
      : {}),
    outputItems: parts
  };
}

function buildGeminiContents(
  input: CodexResponsesInputItem[]
): Record<string, unknown>[] {
  const callNames = new Map<string, string>();

  return input.map((item) => {
    if ("role" in item) {
      return {
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content }]
      };
    }

    if (item.type === "function_call") {
      callNames.set(item.call_id, item.name);

      return {
        role: "model",
        parts: [
          {
            functionCall: {
              name: item.name,
              args: parseJsonObject(item.arguments)
            }
          }
        ]
      };
    }

    return {
      role: "user",
      parts: [
        {
          functionResponse: {
            name: callNames.get(item.call_id) ?? "tool_result",
            response: parseToolOutput(item.output)
          }
        }
      ]
    };
  });
}

function geminiTool(tool: CodexResponsesTool): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  };
}

function geminiGenerateContentUrl(
  baseUrl: string,
  model: string,
  apiKey: string
): string {
  const normalizedModel = model.trim().startsWith("models/")
    ? model.trim()
    : `models/${model.trim()}`;
  const url = new URL(
    `${trimTrailingSlash(baseUrl)}/${normalizedModel}:generateContent`
  );

  url.searchParams.set("key", apiKey);

  return url.toString();
}

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function parseToolOutput(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;

    return isRecord(parsed) ? parsed : { output: parsed };
  } catch {
    return { output: value };
  }
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
