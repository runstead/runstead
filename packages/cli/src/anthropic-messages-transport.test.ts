import { describe, expect, it } from "vitest";

import {
  buildAnthropicMessagesPayload,
  normalizeAnthropicMessagesPayload
} from "./anthropic-messages-transport.js";

describe("Anthropic Messages transport", () => {
  it("converts Runstead model requests to Anthropic messages payloads", () => {
    expect(
      buildAnthropicMessagesPayload({
        model: "claude-opus-4.6",
        instructions: "Use Runstead tools only.",
        input: [
          {
            role: "user",
            content: "Inspect the repo."
          },
          {
            type: "function_call",
            call_id: "toolu_1",
            name: "read_file",
            arguments: '{"path":"package.json"}'
          },
          {
            type: "function_call_output",
            call_id: "toolu_1",
            output: '{"content":"{}"}'
          }
        ],
        tools: [
          {
            type: "function",
            name: "read_file",
            description: "Read file",
            strict: false,
            parameters: {
              type: "object",
              properties: {
                path: { type: "string" }
              }
            }
          }
        ]
      })
    ).toMatchObject({
      model: "claude-opus-4.6",
      system: "Use Runstead tools only.",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: "Inspect the repo."
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "read_file",
              input: {
                path: "package.json"
              }
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: '{"content":"{}"}'
            }
          ]
        }
      ],
      tools: [
        {
          name: "read_file",
          description: "Read file",
          input_schema: {
            type: "object",
            properties: {
              path: { type: "string" }
            }
          }
        }
      ]
    });
  });

  it("normalizes text and tool-use responses", () => {
    expect(
      normalizeAnthropicMessagesPayload({
        id: "msg_1",
        stop_reason: "tool_use",
        content: [
          {
            type: "text",
            text: "I will inspect."
          },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "list_files",
            input: {
              maxResults: 5
            }
          }
        ]
      })
    ).toMatchObject({
      id: "msg_1",
      outputText: "I will inspect.",
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "toolu_1",
          name: "list_files",
          arguments: '{"maxResults":5}'
        }
      ]
    });
  });
});
