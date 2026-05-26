import type { JsonObject } from "@runstead/core";

import type { WrappedWorkerRunResult } from "./wrapped-worker.js";
import type { LocalAgentWorkerGovernanceProfile } from "./local-agent-worker-types.js";

export function redactedLocalWrappedWorkerArgs(
  workerResult: WrappedWorkerRunResult
): string[] {
  const omitted = "[omitted from Runstead durable state]";

  return workerResult.args.map((arg) => (arg === workerResult.prompt ? omitted : arg));
}

export function wrappedWorkerModel(
  workerResult: WrappedWorkerRunResult
): string | undefined {
  const modelFlagIndex = workerResult.args.indexOf("--model");
  const model =
    modelFlagIndex === -1 ? undefined : workerResult.args[modelFlagIndex + 1];

  return typeof model === "string" && model.trim().length > 0
    ? model.trim()
    : undefined;
}

export function wrappedWorkerModelSource(workerResult: WrappedWorkerRunResult): string {
  return wrappedWorkerModel(workerResult) === undefined
    ? wrappedWorkerDefaultModelSource(workerResult)
    : "runstead_model_option";
}

export function wrappedWorkerDefaultModelSource(
  workerResult: WrappedWorkerRunResult
): string {
  return workerResult.worker === "codex_cli"
    ? "codex_cli_config"
    : "claude_code_config";
}

export function wrappedWorkerDefaultModelLabel(
  workerResult: WrappedWorkerRunResult
): string {
  return workerResult.worker === "codex_cli"
    ? "Codex CLI default"
    : "Claude Code CLI default";
}

export function localWrappedWorkerGovernanceOutput(
  workerResult: WrappedWorkerRunResult
): JsonObject {
  const profile: LocalAgentWorkerGovernanceProfile = {
    level: "level_1_wrapper",
    enforcement: workerResult.governance.enforcement,
    boundary: "process_wrapper",
    hardProxyToolCalls: workerResult.governance.capabilities.hardProxyToolCalls,
    internalToolProxy: workerResult.governance.internalToolProxy.mode,
    policyEnforcement: "launch_gate",
    workspaceCheckpoint: workerResult.governance.capabilities.workspaceCheckpoint,
    postRunDiffVerification:
      workerResult.governance.capabilities.postRunDiffVerification,
    auditedActions: ["worker.external.start", "checkpoint", "diff_scope", "verifier"],
    limitations: [
      "worker-internal tool calls are governed only by the worker runtime",
      "Runstead verifies process launch, checkpoint, diff, and verifier evidence after exit"
    ]
  };

  return profile as unknown as JsonObject;
}

export function localNativeWorkerGovernanceOutput(): JsonObject {
  const profile: LocalAgentWorkerGovernanceProfile = {
    level: "level_2_native_proxy",
    boundary: "native_tool_proxy",
    hardProxyToolCalls: true,
    internalToolProxy: "runstead_governed_actions",
    policyEnforcement: "per_tool_call",
    auditedActions: [
      "worker.native.start",
      "model.inference.request",
      "filesystem.read",
      "filesystem.write",
      "filesystem.patch",
      "shell.exec",
      "git.status",
      "git.diff",
      "git.log",
      "git.show",
      "verifier.run",
      "evidence.read",
      "workspace.facts.read"
    ],
    limitations: [
      "native proxy depends on Runstead-owned tool implementations",
      "external MCP/plugin ecosystems remain available through wrapped workers"
    ]
  };

  return profile as unknown as JsonObject;
}
