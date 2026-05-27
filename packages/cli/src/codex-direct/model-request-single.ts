import type { CodexResponsesResult } from "../codex-responses-transport.js";
import { CodexDirectModelTimeoutError } from "./model-request-interruptions.js";

export async function runSingleModelRequestWithHeartbeat(input: {
  timeoutMs: number;
  heartbeatMs: number;
  request: () => Promise<CodexResponsesResult>;
  recordHeartbeat: (stage: "started" | "waiting") => void;
  currentElapsedMs: () => number;
  heartbeatCount: () => number;
}): Promise<CodexResponsesResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  input.recordHeartbeat("started");

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(
        new CodexDirectModelTimeoutError({
          timeoutMs: input.timeoutMs,
          elapsedMs: input.currentElapsedMs(),
          heartbeatCount: input.heartbeatCount()
        })
      );
    }, input.timeoutMs);
    timeout.unref?.();
  });

  if (input.heartbeatMs > 0) {
    heartbeat = setInterval(() => {
      input.recordHeartbeat("waiting");
    }, input.heartbeatMs);
    heartbeat.unref?.();
  }

  try {
    return await Promise.race([input.request(), timeoutPromise]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (heartbeat !== undefined) {
      clearInterval(heartbeat);
    }
  }
}
