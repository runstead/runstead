import { isRecord } from "./doctor-types.js";
import type { ResolvedModelProvider } from "./model-provider.js";

export function codexDirectWorkerAction() {
  return {
    actionId: "doctor_codex_direct_worker",
    actionType: "worker.native.start",
    resource: {
      type: "native_worker",
      id: "codex_direct"
    }
  };
}

export function codexCliWorkerAction() {
  return {
    actionId: "doctor_codex_cli_worker",
    actionType: "worker.external.start",
    resource: {
      type: "process",
      id: "codex_cli"
    }
  };
}

export function claudeCodeWorkerAction() {
  return {
    actionId: "doctor_claude_code_worker",
    actionType: "worker.external.start",
    resource: {
      type: "process",
      id: "claude_code"
    }
  };
}

export function codexModelInferenceAction(resourceId = "chatgpt_codex") {
  return {
    actionId: "doctor_codex_model_inference",
    actionType: "model.inference.request",
    resource: {
      type: "model_provider",
      id: resourceId
    },
    context: {
      sideEffects: ["network_write_external", "llm_data_egress"]
    }
  };
}

export function codexCliAuthHint(stderr: string): string | undefined {
  const normalized = stderr.toLowerCase();

  return normalized.includes("invalid_token") ||
    normalized.includes("authrequired") ||
    normalized.includes("not authorized")
    ? "Codex CLI reported a local CLI/MCP auth problem; this is separate from Runstead Codex Direct login"
    : undefined;
}

export function claudeCodeAuthHint(output: string): string | undefined {
  const normalized = output.toLowerCase();

  return normalized.includes("login") ||
    normalized.includes("not authenticated") ||
    normalized.includes("api key") ||
    normalized.includes("anthropic_api_key") ||
    normalized.includes("oauth") ||
    normalized.includes("subscription") ||
    normalized.includes("credit balance") ||
    normalized.includes("invalid x-api-key") ||
    normalized.includes("invalid api key")
    ? "Claude Code CLI reported a local Claude auth/profile problem; this is separate from Runstead Codex Direct login"
    : undefined;
}

export function claudeCodeProbeSucceeded(stdout: string): boolean {
  try {
    const parsed = JSON.parse(stdout) as unknown;

    if (isRecord(parsed) && parsed.runstead_claude_code_probe === true) {
      return true;
    }

    if (
      isRecord(parsed) &&
      isRecord(parsed.structured_output) &&
      parsed.structured_output.summary === "runstead_claude_code_probe"
    ) {
      return true;
    }

    return (
      isRecord(parsed) &&
      typeof parsed.result === "string" &&
      parsed.result.includes('"runstead_claude_code_probe":true')
    );
  } catch {
    return stdout.includes('"runstead_claude_code_probe":true');
  }
}

export function modelProviderResourceId(selection: ResolvedModelProvider): string {
  return selection.provider === "codex" ? "chatgpt_codex" : selection.provider;
}

export function modelProviderApiKeyOptional(selection: ResolvedModelProvider): boolean {
  return selection.provider === "custom" || selection.provider === "lmstudio";
}
