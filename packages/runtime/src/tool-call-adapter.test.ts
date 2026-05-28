import { describe, expect, it } from "vitest";

import {
  anthropicMessagesToolCallAdapter,
  codexResponsesToolCallAdapter,
  extractAnthropicMessagesToolCalls,
  extractCodexResponsesToolCalls,
  extractGeminiGenerateContentToolCalls,
  extractOpenAiChatCompletionsToolCalls,
  geminiGenerateContentToolCallAdapter,
  openAiChatCompletionsToolCallAdapter,
  runtimeToolArguments
} from "./index.js";

describe("@runstead/runtime tool-call adapter", () => {
  it("normalizes Codex Responses function calls", () => {
    expect(
      extractCodexResponsesToolCalls({
        output: [
          {
            type: "message",
            content: []
          },
          {
            id: "fc_1",
            type: "function_call",
            call_id: "call_1",
            name: "read_file",
            arguments: '{"path":"README.md"}'
          },
          {
            id: "ctc_1",
            type: "custom_tool_call",
            name: "apply_patch",
            input: {
              patch: "*** Begin Patch"
            }
          }
        ]
      })
    ).toEqual([
      {
        id: "call_1",
        name: "read_file",
        arguments: {
          path: "README.md"
        },
        rawArguments: '{"path":"README.md"}',
        provider: "codex_responses",
        responseItemId: "fc_1"
      },
      {
        id: "ctc_1",
        name: "apply_patch",
        arguments: {
          patch: "*** Begin Patch"
        },
        rawArguments: '{"patch":"*** Begin Patch"}',
        provider: "codex_responses",
        responseItemId: "ctc_1"
      }
    ]);
    expect(
      codexResponsesToolCallAdapter.toolResultMessage({
        callId: "call_1",
        output: {
          ok: true
        }
      })
    ).toEqual({
      type: "function_call_output",
      call_id: "call_1",
      output: '{"ok":true}'
    });
  });

  it("normalizes OpenAI-compatible chat completion tool calls", () => {
    expect(
      extractOpenAiChatCompletionsToolCalls({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "tool_1",
                  type: "function",
                  function: {
                    name: "search_text",
                    arguments: '{"query":"TODO"}'
                  }
                }
              ]
            }
          }
        ]
      })
    ).toEqual([
      {
        id: "tool_1",
        name: "search_text",
        arguments: {
          query: "TODO"
        },
        rawArguments: '{"query":"TODO"}',
        provider: "openai_chat_completions"
      }
    ]);
    expect(
      openAiChatCompletionsToolCallAdapter.toolResultMessage({
        callId: "tool_1",
        output: "done"
      })
    ).toEqual({
      role: "tool",
      tool_call_id: "tool_1",
      content: "done"
    });
  });

  it("normalizes Anthropic Messages tool calls", () => {
    expect(
      extractAnthropicMessagesToolCalls({
        content: [
          {
            type: "text",
            text: "Inspecting files"
          },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "read_file",
            input: {
              path: "package.json"
            }
          }
        ]
      })
    ).toEqual([
      {
        id: "toolu_1",
        name: "read_file",
        arguments: {
          path: "package.json"
        },
        rawArguments: '{"path":"package.json"}',
        provider: "anthropic_messages",
        responseItemId: "toolu_1"
      }
    ]);
    expect(
      anthropicMessagesToolCallAdapter.toolResultMessage({
        callId: "toolu_1",
        output: "done"
      })
    ).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: "done"
        }
      ]
    });
  });

  it("normalizes Gemini generateContent tool calls", () => {
    expect(
      extractGeminiGenerateContentToolCalls({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: "Inspecting files"
                },
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
    ).toEqual([
      {
        id: "call_1",
        name: "read_file",
        arguments: {
          path: "package.json"
        },
        rawArguments: '{"path":"package.json"}',
        provider: "gemini_generate_content"
      }
    ]);
    expect(
      geminiGenerateContentToolCallAdapter.toolResultMessage({
        callId: "call_1",
        name: "read_file",
        output: {
          ok: true
        }
      })
    ).toEqual({
      role: "user",
      parts: [
        {
          functionResponse: {
            name: "read_file",
            response: {
              ok: true
            }
          }
        }
      ]
    });
  });

  it("keeps malformed JSON raw arguments for provider-specific diagnostics", () => {
    expect(runtimeToolArguments("{bad json")).toEqual({
      arguments: {},
      rawArguments: "{bad json"
    });
  });
});
