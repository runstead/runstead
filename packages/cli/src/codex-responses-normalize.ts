import type {
  CodexResponsesResult,
  CodexResponsesToolCall
} from "./codex-responses-types.js";

export function normalizeCodexResponsesStream(stream: string): CodexResponsesResult {
  const outputItems = new Map<number, unknown>();
  const textParts: string[] = [];
  let responseId: string | undefined;
  let responseStatus: string | undefined;

  for (const event of parseServerSentEvents(stream)) {
    if (!isRecord(event)) {
      continue;
    }

    if (event.type === "response.completed" && isRecord(event.response)) {
      const response = event.response;

      if (typeof response.id === "string") {
        responseId = response.id;
      }
      if (typeof response.status === "string") {
        responseStatus = response.status;
      }
      if (Array.isArray(response.output) && response.output.length > 0) {
        response.output.forEach((item, index) => outputItems.set(index, item));
      }
      continue;
    }

    if (event.type === "response.output_item.done") {
      const outputIndex = integerOrUndefined(event.output_index);

      if (outputIndex !== undefined) {
        outputItems.set(outputIndex, event.item);
      }
      continue;
    }

    if (event.type === "response.output_text.done" && typeof event.text === "string") {
      textParts.push(event.text);
    }
  }

  return normalizeCodexResponsesPayload({
    ...(responseId === undefined ? {} : { id: responseId }),
    status: responseStatus ?? "completed",
    output: [...outputItems.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, item]) => item),
    ...(textParts.length === 0 ? {} : { output_text: textParts.join("") })
  });
}

export function normalizeCodexResponsesPayload(payload: unknown): CodexResponsesResult {
  if (!isRecord(payload)) {
    throw new Error("Codex Responses payload was not an object");
  }

  const outputItems = Array.isArray(payload.output) ? payload.output : [];

  if (outputItems.length === 0 && typeof payload.output_text !== "string") {
    throw new Error("Codex Responses payload returned no output items");
  }

  const textParts: string[] = [];
  const toolCalls: CodexResponsesToolCall[] = [];
  let hasIncomplete = payload.status === "queued" || payload.status === "in_progress";

  for (const item of outputItems) {
    if (!isRecord(item)) {
      continue;
    }

    if (item.status === "queued" || item.status === "in_progress") {
      hasIncomplete = true;
    }

    if (item.type === "message") {
      textParts.push(extractOutputText(item.content));
      continue;
    }

    if (item.type === "function_call" || item.type === "custom_tool_call") {
      const name = item.name;
      const rawArguments =
        item.type === "custom_tool_call" ? item.input : item.arguments;

      if (typeof name !== "string" || name.trim().length === 0) {
        continue;
      }

      const callId =
        typeof item.call_id === "string" && item.call_id.trim().length > 0
          ? item.call_id.trim()
          : typeof item.id === "string" && item.id.trim().length > 0
            ? item.id.trim()
            : `call_${toolCalls.length + 1}`;
      const responseItemId =
        typeof item.id === "string" && item.id.trim().length > 0
          ? item.id.trim()
          : undefined;

      toolCalls.push({
        id: callId,
        name: name.trim(),
        arguments:
          typeof rawArguments === "string"
            ? rawArguments
            : JSON.stringify(rawArguments ?? {}),
        ...(responseItemId === undefined ? {} : { responseItemId })
      });
    }
  }

  const outputText =
    textParts.filter(Boolean).join("\n").trim() ||
    (typeof payload.output_text === "string" ? payload.output_text.trim() : "");

  return {
    ...(typeof payload.id === "string" ? { id: payload.id } : {}),
    ...(typeof payload.status === "string" ? { status: payload.status } : {}),
    outputText,
    toolCalls,
    finishReason:
      toolCalls.length > 0 ? "tool_calls" : hasIncomplete ? "incomplete" : "stop",
    outputItems
  };
}

function parseServerSentEvents(stream: string): unknown[] {
  return stream.split(/\r?\n\r?\n/).flatMap((block) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n")
      .trim();

    if (data.length === 0 || data === "[DONE]") {
      return [];
    }

    try {
      return [JSON.parse(data) as unknown];
    } catch {
      return [];
    }
  });
}

function extractOutputText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((part) => {
      if (!isRecord(part)) {
        return [];
      }

      if (
        (part.type === "output_text" || part.type === "text") &&
        typeof part.text === "string"
      ) {
        return [part.text];
      }

      return [];
    })
    .join("")
    .trim();
}

function integerOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
