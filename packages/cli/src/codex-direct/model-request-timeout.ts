import {
  DEFAULT_CODEX_DIRECT_FINAL_SUMMARY_REQUEST_TIMEOUT_MS,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_TIMEOUT_MS
} from "./constants.js";
import type {
  CodexDirectModelRequestPhase,
  CodexDirectWorkerOptions
} from "./worker-types.js";

export function modelRequestTimeoutMs(
  options: CodexDirectWorkerOptions,
  phase: CodexDirectModelRequestPhase
): number {
  const defaultTimeout =
    phase === "final_summary"
      ? DEFAULT_CODEX_DIRECT_FINAL_SUMMARY_REQUEST_TIMEOUT_MS
      : DEFAULT_CODEX_DIRECT_MODEL_REQUEST_TIMEOUT_MS;
  const configured =
    phase === "final_summary"
      ? (options.modelFinalSummaryRequestTimeoutMs ?? options.modelRequestTimeoutMs)
      : options.modelRequestTimeoutMs;

  return configured ?? defaultTimeout;
}
