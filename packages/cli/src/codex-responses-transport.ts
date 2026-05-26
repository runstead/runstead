import { DEFAULT_CODEX_BASE_URL, codexBackendHeaders } from "./codex-auth.js";
import { normalizeCodexResponsesStream } from "./codex-responses-normalize.js";
import { buildCodexResponsesPayload } from "./codex-responses-payload.js";
import type {
  CodexResponsesRequest,
  CodexResponsesResult,
  CodexResponsesTransportOptions,
  FetchLike
} from "./codex-responses-types.js";

export {
  normalizeCodexResponsesPayload,
  normalizeCodexResponsesStream
} from "./codex-responses-normalize.js";
export { buildCodexResponsesPayload } from "./codex-responses-payload.js";
export type {
  CodexResponsesFunctionCallInputItem,
  CodexResponsesFunctionCallOutputInputItem,
  CodexResponsesInputItem,
  CodexResponsesMessageInputItem,
  CodexResponsesRequest,
  CodexResponsesResult,
  CodexResponsesTool,
  CodexResponsesToolCall,
  CodexResponsesTransportOptions,
  FetchLike
} from "./codex-responses-types.js";

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
        ...codexBackendHeaders(this.accessToken),
        Accept: "text/event-stream",
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...codexSessionHeaders(request.sessionId)
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Codex Responses request failed with status ${response.status}`);
    }

    return normalizeCodexResponsesStream(await response.text());
  }
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

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}
