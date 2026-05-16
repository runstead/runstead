import { describe, expect, it } from "vitest";

import {
  buildOpenAiChatCompletionsPayload,
  normalizeOpenAiChatCompletionsPayload,
  OpenAiChatCompletionsTransport
} from "./openai-chat-completions-transport.js";

describe("OpenAI-compatible chat completions transport", () => {
  it("converts Runstead model requests to chat completions payloads", () => {
    expect(
      buildOpenAiChatCompletionsPayload({
        model: "deepseek-chat",
        instructions: "Use Runstead tools only.",
        input: [
          {
            role: "user",
            content: "Inspect the repo."
          },
          {
            type: "function_call",
            call_id: "call_1",
            name: "list_files",
            arguments: '{"maxResults":5}'
          },
          {
            type: "function_call_output",
            call_id: "call_1",
            output: '{"entries":[]}'
          }
        ],
        tools: [
          {
            type: "function",
            name: "list_files",
            description: "List files",
            strict: false,
            parameters: {
              type: "object",
              properties: {}
            }
          }
        ],
        maxOutputTokens: 1024
      })
    ).toMatchObject({
      model: "deepseek-chat",
      stream: false,
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content: "Use Runstead tools only."
        },
        {
          role: "user",
          content: "Inspect the repo."
        },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "list_files",
                arguments: '{"maxResults":5}'
              }
            }
          ]
        },
        {
          role: "tool",
          tool_call_id: "call_1",
          content: '{"entries":[]}'
        }
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "list_files",
            description: "List files",
            parameters: {
              type: "object",
              properties: {}
            }
          }
        }
      ]
    });
  });

  it("normalizes text and tool-call responses", () => {
    expect(
      normalizeOpenAiChatCompletionsPayload({
        id: "chatcmpl_1",
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: '{"path":"package.json"}'
                  }
                }
              ]
            }
          }
        ]
      })
    ).toMatchObject({
      id: "chatcmpl_1",
      outputText: "",
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "call_1",
          name: "read_file",
          arguments: '{"path":"package.json"}'
        }
      ]
    });

    expect(
      normalizeOpenAiChatCompletionsPayload({
        choices: [
          {
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "Done."
            }
          }
        ]
      })
    ).toMatchObject({
      outputText: "Done.",
      finishReason: "stop",
      toolCalls: []
    });
  });

  it("posts without leaking bearer tokens in errors", async () => {
    const transport = new OpenAiChatCompletionsTransport({
      baseUrl: "https://example.com/v1/",
      apiKey: "secret-token",
      fetch: () =>
        Promise.resolve(
          new Response("bad", {
            status: 401
          })
        )
    });

    await expect(
      transport.createResponse({
        model: "model",
        instructions: "instructions",
        input: []
      })
    ).rejects.toThrow("request failed with status 401");
    await expect(
      transport.createResponse({
        model: "model",
        instructions: "instructions",
        input: []
      })
    ).rejects.not.toThrow("secret-token");
  });
});
