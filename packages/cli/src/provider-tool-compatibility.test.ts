import { describe, expect, it } from "vitest";

import { normalizeAnthropicMessagesPayload } from "./anthropic-messages-transport.js";
import type { CodexResponsesResult } from "./codex-responses-transport.js";
import { normalizeGeminiGenerateContentPayload } from "./gemini-generate-content-transport.js";
import { normalizeOpenAiChatCompletionsPayload } from "./openai-chat-completions-transport.js";

describe("provider tool-loop compatibility", () => {
  it("normalizes provider-native tool calls into the Codex Responses shape", () => {
    const normalized = [
      normalizeOpenAiChatCompletionsPayload({
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
      }),
      normalizeAnthropicMessagesPayload({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "call_1",
            name: "read_file",
            input: {
              path: "package.json"
            }
          }
        ]
      }),
      normalizeGeminiGenerateContentPayload({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                {
                  functionCall: {
                    name: "read_file",
                    args: {
                      path: "package.json"
                    }
                  }
                }
              ]
            }
          }
        ]
      })
    ];

    normalized.forEach((result) => {
      expectToolCall(result);
    });
  });
});

function expectToolCall(result: CodexResponsesResult): void {
  expect(result.finishReason).toBe("tool_calls");
  expect(result.toolCalls).toHaveLength(1);
  expect(result.toolCalls[0]).toMatchObject({
    name: "read_file",
    arguments: '{"path":"package.json"}'
  });
}
