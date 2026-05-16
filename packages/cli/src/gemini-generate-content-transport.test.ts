import { describe, expect, it } from "vitest";

import {
  buildGeminiGenerateContentPayload,
  GeminiGenerateContentTransport,
  normalizeGeminiGenerateContentPayload
} from "./gemini-generate-content-transport.js";

describe("Gemini generateContent transport", () => {
  it("converts Runstead model requests to Gemini generateContent payloads", () => {
    expect(
      buildGeminiGenerateContentPayload({
        model: "gemini-2.5-flash",
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
        maxOutputTokens: 2048
      })
    ).toMatchObject({
      systemInstruction: {
        parts: [{ text: "Use Runstead tools only." }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: "Inspect the repo." }]
        },
        {
          role: "model",
          parts: [
            {
              functionCall: {
                name: "list_files",
                args: { maxResults: 5 }
              }
            }
          ]
        },
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "list_files",
                response: { entries: [] }
              }
            }
          ]
        }
      ],
      tools: [
        {
          functionDeclarations: [
            {
              name: "list_files",
              description: "List files",
              parameters: {
                type: "object",
                properties: {}
              }
            }
          ]
        }
      ],
      generationConfig: {
        maxOutputTokens: 2048
      }
    });
  });

  it("normalizes text and function-call responses", () => {
    expect(
      normalizeGeminiGenerateContentPayload({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              role: "model",
              parts: [
                {
                  text: "I will inspect."
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
    ).toMatchObject({
      outputText: "I will inspect.",
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "call_1",
          name: "read_file",
          arguments: '{"path":"package.json"}'
        }
      ]
    });
  });

  it("posts to model generateContent endpoints without leaking api keys in errors", async () => {
    let requestedUrl = "";
    const transport = new GeminiGenerateContentTransport({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/",
      apiKey: "gemini-secret",
      fetch: (input) => {
        requestedUrl = String(input);
        return Promise.resolve(
          new Response("bad", {
            status: 403
          })
        );
      }
    });

    await expect(
      transport.createResponse({
        model: "gemini-2.5-flash",
        instructions: "instructions",
        input: []
      })
    ).rejects.toThrow("request failed with status 403");
    expect(requestedUrl).toContain("/models/gemini-2.5-flash:generateContent");
    expect(requestedUrl).toContain("key=gemini-secret");
  });
});
