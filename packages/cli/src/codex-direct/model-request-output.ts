import type { JsonObject } from "@runstead/core";

import type { CodexResponsesResult } from "../codex-responses-transport.js";
import type { CodexDirectModelRequestPhase } from "./worker-types.js";

export function codexDirectModelRequestOutput(input: {
  model: string;
  phase: CodexDirectModelRequestPhase;
  value: CodexResponsesResult;
  elapsedMs: number;
  heartbeatCount: number;
  attempts: number;
  retryCount: number;
}): JsonObject {
  return {
    model: input.model,
    status: input.value.status ?? "unknown",
    finishReason: input.value.finishReason,
    phase: input.phase,
    elapsedMs: input.elapsedMs,
    heartbeatCount: input.heartbeatCount,
    attempts: input.attempts,
    retryCount: input.retryCount,
    toolCalls: input.value.toolCalls.length,
    outputTextBytes: Buffer.byteLength(input.value.outputText, "utf8")
  };
}
