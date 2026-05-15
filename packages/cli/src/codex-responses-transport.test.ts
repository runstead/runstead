import { describe, expect, it } from "vitest";

import {
  CodexResponsesTransport,
  buildCodexResponsesPayload,
  normalizeCodexResponsesPayload
} from "./codex-responses-transport.js";

describe("CodexResponsesTransport", () => {
  it("builds the minimal Codex Responses payload with store disabled", () => {
    const payload = buildCodexResponsesPayload({
      model: "gpt-5.1-codex",
      instructions: "You are a governed Runstead worker.",
      input: [{ role: "user", content: "Fix the test." }],
      tools: [
        {
          type: "function",
          name: "read_file",
          description: "Read a workspace file.",
          strict: false,
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" }
            },
            required: ["path"]
          }
        }
      ],
      reasoningEffort: "xhigh",
      maxOutputTokens: 4096
    });

    expect(payload).toMatchObject({
      model: "gpt-5.1-codex",
      instructions: "You are a governed Runstead worker.",
      store: false,
      tool_choice: "auto",
      parallel_tool_calls: true,
      reasoning: {
        effort: "high",
        summary: "auto"
      },
      include: ["reasoning.encrypted_content"],
      max_output_tokens: 4096
    });
    expect(JSON.stringify(payload)).not.toContain("Bearer");
  });

  it("sends authenticated requests to the Codex backend without storing responses", async () => {
    const requests: Array<{
      input: string | URL;
      init?: RequestInit;
    }> = [];
    const transport = new CodexResponsesTransport({
      baseUrl: "https://codex.example/api/",
      accessToken: "secret-token",
      fetch: async (input, init) => {
        requests.push({
          input,
          ...(init === undefined ? {} : { init })
        });

        return jsonResponse({
          id: "resp_1",
          status: "completed",
          output: [
            {
              type: "message",
              status: "completed",
              content: [{ type: "output_text", text: "Done." }]
            }
          ]
        });
      }
    });

    const result = await transport.createResponse({
      model: "gpt-5.1-codex",
      instructions: "system",
      input: [{ role: "user", content: "hello" }],
      sessionId: "session-1"
    });
    const request = requests[0];
    const body = JSON.parse(String(request?.init?.body)) as Record<string, unknown>;

    expect(String(request?.input)).toBe("https://codex.example/api/responses");
    expect(request?.init?.headers).toMatchObject({
      Authorization: "Bearer secret-token",
      session_id: "session-1",
      "x-client-request-id": "session-1"
    });
    expect(body.store).toBe(false);
    expect(JSON.stringify(body)).not.toContain("secret-token");
    expect(result).toMatchObject({
      id: "resp_1",
      outputText: "Done.",
      finishReason: "stop",
      toolCalls: []
    });
  });

  it("normalizes function calls and incomplete responses", () => {
    const toolResult = normalizeCodexResponsesPayload({
      status: "completed",
      output: [
        {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "read_file",
          arguments: '{"path":"README.md"}'
        }
      ]
    });
    const incompleteResult = normalizeCodexResponsesPayload({
      status: "in_progress",
      output_text: ""
    });

    expect(toolResult).toMatchObject({
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "call_1",
          responseItemId: "fc_1",
          name: "read_file",
          arguments: '{"path":"README.md"}'
        }
      ]
    });
    expect(incompleteResult.finishReason).toBe("incomplete");
  });

  it("does not include bearer tokens in transport errors", async () => {
    const transport = new CodexResponsesTransport({
      accessToken: "secret-token",
      fetch: async () => jsonResponse({ error: "bad" }, 500)
    });

    await expect(
      transport.createResponse({
        model: "gpt-5.1-codex",
        instructions: "system",
        input: [{ role: "user", content: "hello" }]
      })
    ).rejects.toThrow("Codex Responses request failed with status 500");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}
