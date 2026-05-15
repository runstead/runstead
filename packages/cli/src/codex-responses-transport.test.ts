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
          jsonResponse({
            id: "resp_1",
            status: "completed",
            output: [
              {
                type: "message",
                status: "completed",
                content: [{ type: "output_text", text: "Done." }]
              }
            ]
          })
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
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
