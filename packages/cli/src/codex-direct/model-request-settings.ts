import {
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_HEARTBEAT_MS,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_MAX_RETRIES,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_BASE_DELAY_MS,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_JITTER_MS,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_MAX_DELAY_MS
} from "./constants.js";
import type { CodexDirectWorkerOptions } from "./worker-types.js";

export interface CodexDirectModelRequestSettings {
  heartbeatMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  retryJitterMs: number;
}

export function codexDirectModelRequestSettings(
  options: CodexDirectWorkerOptions
): CodexDirectModelRequestSettings {
  return {
    heartbeatMs:
      options.modelRequestHeartbeatMs ??
      DEFAULT_CODEX_DIRECT_MODEL_REQUEST_HEARTBEAT_MS,
    maxRetries:
      options.modelRequestMaxRetries ?? DEFAULT_CODEX_DIRECT_MODEL_REQUEST_MAX_RETRIES,
    retryBaseDelayMs:
      options.modelRequestRetryBaseDelayMs ??
      DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_BASE_DELAY_MS,
    retryMaxDelayMs:
      options.modelRequestRetryMaxDelayMs ??
      DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_MAX_DELAY_MS,
    retryJitterMs:
      options.modelRequestRetryJitterMs ??
      DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_JITTER_MS
  };
}
