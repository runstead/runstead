import type { LocalAgentDiagnostic } from "./local-agent-diagnostic-types.js";

export function codexAuthDiagnostic(
  status: string,
  summary: string
): LocalAgentDiagnostic | undefined {
  if (status !== "failed") {
    return undefined;
  }

  const normalized = summary.toLowerCase();
  const authSignals = ["401", "unauthorized", "access token", "credentials", "login"];

  return normalized.includes("codex") &&
    authSignals.some((signal) => normalized.includes(signal))
    ? {
        cause: summary,
        likelyReason: "Codex Direct credentials are missing, expired, or rejected.",
        retry: "runstead codex status, then runstead codex login if needed"
      }
    : undefined;
}

export function codexModelDiagnostic(
  status: string,
  summary: string
): LocalAgentDiagnostic | undefined {
  if (status !== "failed") {
    return undefined;
  }

  const normalized = summary.toLowerCase();
  const modelSignals = ["not found", "does not exist", "unsupported"];

  return normalized.includes("model") &&
    modelSignals.some((signal) => normalized.includes(signal))
    ? {
        cause: summary,
        likelyReason: "The selected Codex model is unavailable to the current account.",
        retry: "runstead codex models --refresh"
      }
    : undefined;
}
