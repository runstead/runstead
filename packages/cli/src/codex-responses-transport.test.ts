import { describe, expect, it } from "vitest";

import {
  CodexResponsesTransport,
  buildCodexResponsesPayload,
  normalizeCodexResponsesPayload,
  normalizeCodexResponsesStream
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
      stream: true,
      tool_choice: "auto",
      parallel_tool_calls: true,
      reasoning: {
        effort: "high",
        summary: "auto"
      },
      include: ["reasoning.encrypted_content"]
    });
    expect(payload).not.toHaveProperty("max_output_tokens");
    expect(JSON.stringify(payload)).not.toContain("Bearer");
  });

  it("sends authenticated requests to the Codex backend without storing responses", async () => {
    const requests: {
      input: string | URL;
      init?: RequestInit;
    }[] = [];
    const accessToken = jwtWithCodexAccount("acct-responses-1");
    const transport = new CodexResponsesTransport({
      baseUrl: "https://codex.example/api/",
      accessToken,
      fetch: (input, init) => {
        requests.push({
          input,
          ...(init === undefined ? {} : { init })
        });

        return Promise.resolve(
          textResponse(
            sse("response.output_item.done", {
              type: "response.output_item.done",
              output_index: 0,
              item: {
                type: "message",
                status: "completed",
                content: [{ type: "output_text", text: "Done." }]
              }
            }) +
              sse("response.completed", {
                type: "response.completed",
                response: {
                  id: "resp_1",
                  status: "completed",
                  output: []
                }
              })
          )
        );
      }
    });

    const result = await transport.createResponse({
      model: "gpt-5.1-codex",
      instructions: "system",
      input: [{ role: "user", content: "hello" }],
      sessionId: "session-1"
    });
    const request = requests[0];
    const body = JSON.parse(requireStringBody(request?.init)) as Record<
      string,
      unknown
    >;

    expect(String(request?.input)).toBe("https://codex.example/api/responses");
    expect(request?.init?.headers).toMatchObject({
      Accept: "text/event-stream",
      Authorization: `Bearer ${accessToken}`,
      "ChatGPT-Account-ID": "acct-responses-1",
      originator: "codex_cli_rs",
      session_id: "session-1",
      "x-client-request-id": "session-1"
    });
    expect((request?.init?.headers as Record<string, string>)["User-Agent"]).toMatch(
      /^codex_cli_rs\//
    );
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
    expect(JSON.stringify(body)).not.toContain(accessToken);
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

  it("normalizes streamed text and function call events", () => {
    const textResult = normalizeCodexResponsesStream(
      [
        sse("response.output_text.done", {
          type: "response.output_text.done",
          text: "Done.",
          output_index: 0
        }),
        sse("response.completed", {
          type: "response.completed",
          response: {
            id: "resp_1",
            status: "completed",
            output: []
          }
        })
      ].join("\n")
    );
    const toolResult = normalizeCodexResponsesStream(
      [
        sse("response.output_item.done", {
          type: "response.output_item.done",
          output_index: 0,
          item: {
            id: "fc_1",
            type: "function_call",
            status: "completed",
            call_id: "call_1",
            name: "git_status",
            arguments: "{}"
          }
        }),
        sse("response.completed", {
          type: "response.completed",
          response: {
            id: "resp_2",
            status: "completed",
            output: []
          }
        })
      ].join("\n")
    );

    expect(textResult).toMatchObject({
      id: "resp_1",
      outputText: "Done.",
      finishReason: "stop"
    });
    expect(toolResult).toMatchObject({
      id: "resp_2",
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "call_1",
          name: "git_status",
          arguments: "{}",
          responseItemId: "fc_1"
        }
      ]
    });
  });

  it("does not include bearer tokens in transport errors", async () => {
    const transport = new CodexResponsesTransport({
      accessToken: "secret-token",
      fetch: () => Promise.resolve(jsonResponse({ error: "bad" }, 500))
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

function jwtWithCodexAccount(accountId: string): string {
  return [
    base64Url(JSON.stringify({ alg: "none" })),
    base64Url(
      JSON.stringify({
        "https://api.openai.com/auth": {
          chatgpt_account_id: accountId
        }
      })
    ),
    "signature"
  ].join(".");
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/event-stream"
    }
  });
}

function requireStringBody(init: RequestInit | undefined): string {
  const body = init?.body;

  if (typeof body !== "string") {
    throw new Error("Expected string request body");
  }

  return body;
}
