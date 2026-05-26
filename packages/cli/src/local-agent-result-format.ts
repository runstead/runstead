import type { RuntimeExecutionSemantics } from "@runstead/runtime";

import {
  CODEX_DIRECT_WORKER_KIND,
  type CodexDirectWorkerResult
} from "./codex-direct-worker.js";
import {
  localNativeWorkerGovernanceOutput,
  localWrappedWorkerGovernanceOutput,
  wrappedWorkerDefaultModelLabel,
  wrappedWorkerModel,
  wrappedWorkerModelSource
} from "./local-agent-worker-output.js";
import type { LocalAgentWorkerResult } from "./local-agent-worker-types.js";

export function formatLocalAgentWorkerResultLines(
  workerResult: LocalAgentWorkerResult
): string[] {
  if (isCodexDirectWorkerResult(workerResult)) {
    const governance = localNativeWorkerGovernanceOutput();

    return [
      `Worker: ${workerResult.worker}`,
      `Provider: ${workerResult.modelProvider}`,
      `Model: ${workerResult.model}`,
      `Worker status: ${workerResult.status}`,
      `Governance: ${String(governance.level)}`,
      `Tool proxy: ${String(governance.internalToolProxy)} (${String(governance.policyEnforcement)})`,
      `Tool calls: ${workerResult.toolCalls}`,
      `Failed tool calls: ${workerResult.failedToolCalls}`,
      ...(workerResult.interruption === undefined
        ? []
        : formatCodexDirectInterruptionLines(workerResult.interruption))
    ];
  }

  return [
    `Worker: ${workerResult.worker}`,
    `Command: ${workerResult.command}`,
    `Mode: wrapped external worker`,
    `Model: ${wrappedWorkerModel(workerResult) ?? wrappedWorkerDefaultModelLabel(workerResult)}`,
    `Model source: ${wrappedWorkerModelSource(workerResult)}`,
    `Governance: ${String(localWrappedWorkerGovernanceOutput(workerResult).level)}`,
    "Tool proxy: none (worker-internal tool calls are not hard-proxied)",
    `Exit: ${workerResult.exitCode}`,
    `Output valid: ${workerResult.outputValidation.valid ? "yes" : "no"}`,
    `Stdout: ${Buffer.byteLength(workerResult.stdout, "utf8")} bytes`,
    `Stderr: ${Buffer.byteLength(workerResult.stderr, "utf8")} bytes`
  ];
}

export function formatExecutionSemanticsLines(
  execution: RuntimeExecutionSemantics
): string[] {
  return [
    "Execution:",
    `  implementation: ${execution.implementation}`,
    `  verification: ${execution.verification}`,
    `  agentCompletion: ${execution.agentCompletion}`
  ];
}

function formatCodexDirectInterruptionLines(
  interruption: NonNullable<CodexDirectWorkerResult["interruption"]>
): string[] {
  if (interruption.reason === "model_timeout") {
    return [
      `Interruption: ${interruption.reason} after ${interruption.timeoutMs}ms`,
      `Retry: ${interruption.retryCommand}`
    ];
  }

  return [
    `Interruption: ${interruption.reason} after ${interruption.attempts} attempts`,
    `Retry: ${interruption.retryCommand}`
  ];
}

function isCodexDirectWorkerResult(
  workerResult: LocalAgentWorkerResult
): workerResult is CodexDirectWorkerResult {
  return workerResult.worker === CODEX_DIRECT_WORKER_KIND;
}
