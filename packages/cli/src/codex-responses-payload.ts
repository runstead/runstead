import type {
  CodexResponsesInputItem,
  CodexResponsesRequest,
  CodexResponsesTool
} from "./codex-responses-types.js";

export function buildCodexResponsesPayload(
  request: CodexResponsesRequest
): Record<string, unknown> {
  if (request.model.trim().length === 0) {
    throw new Error("Codex Responses request model is required");
  }

  return {
    model: request.model.trim(),
    instructions: request.instructions,
    input: normalizeInputItems(request.input),
    store: false,
    stream: true,
    tool_choice: request.tools === undefined ? "none" : "auto",
    parallel_tool_calls: request.tools !== undefined,
    ...(request.tools === undefined ? {} : { tools: normalizeTools(request.tools) }),
    reasoning: {
      effort: normalizeReasoningEffort(request.reasoningEffort),
      summary: "auto"
    },
    include: ["reasoning.encrypted_content"]
  };
}

function normalizeInputItems(
  input: CodexResponsesInputItem[]
): CodexResponsesInputItem[] {
  return input.map((item) => {
    if ("role" in item) {
      return {
        role: item.role,
        content: item.content
      };
    }

    if (item.type === "function_call") {
      return {
        type: "function_call",
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments
      };
    }

    return {
      type: "function_call_output",
      call_id: item.call_id,
      output: item.output
    };
  });
}

function normalizeTools(tools: CodexResponsesTool[]): CodexResponsesTool[] {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    strict: tool.strict,
    parameters: tool.parameters
  }));
}

function normalizeReasoningEffort(
  effort: CodexResponsesRequest["reasoningEffort"]
): "low" | "medium" | "high" {
  if (effort === "xhigh") {
    return "high";
  }

  return effort ?? "medium";
}
