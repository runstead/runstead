import type { JsonObject, Task } from "@runstead/core";
import {
  runtimeExecutionSemantics,
  runtimeFinalTaskStatus,
  runtimeTaskResultStatus,
  runtimeWorkerRunStatusFromTaskStatus,
  type RuntimeExecutionSemantics,
  type RuntimeVerifierOutcome,
  type RuntimeWorkerOutcome
} from "@runstead/runtime";

import type { WorkspaceCheckpoint } from "./checkpoints.js";
import {
  CODEX_DIRECT_WORKER_KIND,
  type CodexDirectWorkerResult
} from "./codex-direct-worker.js";
import {
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "./governed-action.js";
import type { RunTaskVerifiersResult } from "./verifier-runner.js";
import type { WrappedWorkerRunResult } from "./wrapped-worker.js";

export type LocalAgentWorkerResult = CodexDirectWorkerResult | WrappedWorkerRunResult;

export interface LocalAgentWorkerGovernanceProfile {
  level: "level_1_wrapper" | "level_2_native_proxy";
  enforcement?: string;
  boundary: "process_wrapper" | "native_tool_proxy";
  hardProxyToolCalls: boolean;
  internalToolProxy: "none" | "runstead_governed_actions";
  policyEnforcement: "launch_gate" | "per_tool_call";
  workspaceCheckpoint?: boolean;
  postRunDiffVerification?: boolean;
  auditedActions: string[];
  limitations: string[];
}

export function localAgentFinalTaskStatus(
  workerResult: LocalAgentWorkerResult,
  verifierResult?: RunTaskVerifiersResult
): Task["status"] {
  const worker = localAgentWorkerOutcome(workerResult);
  const verifier = localAgentEffectiveVerifierOutcome(workerResult, verifierResult);

  return verifier === undefined
    ? runtimeFinalTaskStatus({ worker })
    : runtimeFinalTaskStatus({ worker, verifier });
}

export function localAgentResultStatus(
  status: Task["status"],
  workerResult?: LocalAgentWorkerResult
):
  | "completed"
  | "completed_with_warnings"
  | "waiting_approval"
  | "interrupted"
  | "blocked"
  | "failed" {
  return runtimeTaskResultStatus({
    taskStatus: status,
    ...(workerResult === undefined
      ? {}
      : { worker: localAgentWorkerOutcome(workerResult) })
  });
}

export function localAgentWorkerRunStatus(
  status: Task["status"]
): "completed" | "waiting_approval" | "interrupted" | "blocked" | "failed" {
  return runtimeWorkerRunStatusFromTaskStatus(status);
}

export function localAgentFinalSummary(
  workerResult: LocalAgentWorkerResult,
  verifierResult?: RunTaskVerifiersResult
): string {
  if (!isCodexDirectLocalAgentWorkerResult(workerResult)) {
    const summary =
      workerResult.structuredOutput?.summary ??
      (workerResult.stderr.length === 0
        ? `Wrapped worker exited ${workerResult.exitCode}`
        : workerResult.stderr.trim());

    if (verifierResult === undefined) {
      return summary;
    }

    const verifierSummary = verifierResult.task.output?.summary;

    return typeof verifierSummary === "string" && verifierSummary.length > 0
      ? `${summary} Verifiers: ${verifierSummary}`
      : summary;
  }

  if (verifierResult === undefined) {
    return workerResult.summary;
  }

  const verifierSummary = verifierResult.task.output?.summary;

  return typeof verifierSummary === "string" && verifierSummary.length > 0
    ? `${workerResult.summary} Verifiers: ${verifierSummary}`
    : workerResult.summary;
}

export function localAgentExecutionSemantics(input: {
  workerResult: LocalAgentWorkerResult;
  verifierResult?: RunTaskVerifiersResult;
}): RuntimeExecutionSemantics {
  const worker = localAgentWorkerOutcome(input.workerResult);
  const verifier = localAgentEffectiveVerifierOutcome(
    input.workerResult,
    input.verifierResult
  );

  return verifier === undefined
    ? runtimeExecutionSemantics({ worker })
    : runtimeExecutionSemantics({ worker, verifier });
}

export function localAgentTaskOutput(input: {
  workerResult: LocalAgentWorkerResult;
  summary: string;
  checkpoint?: WorkspaceCheckpoint;
  verifierResult?: RunTaskVerifiersResult;
}): JsonObject {
  if (!isCodexDirectLocalAgentWorkerResult(input.workerResult)) {
    return {
      summary: input.summary,
      worker: input.workerResult.worker,
      status: input.workerResult.exitCode === 0 ? "completed" : "failed",
      exitCode: input.workerResult.exitCode,
      command: input.workerResult.command,
      args: redactedLocalWrappedWorkerArgs(input.workerResult),
      governance: localWrappedWorkerGovernanceOutput(input.workerResult),
      execution: localAgentExecutionSemantics(input),
      outputValidation: input.workerResult.outputValidation,
      stdoutBytes: Buffer.byteLength(input.workerResult.stdout, "utf8"),
      stderrBytes: Buffer.byteLength(input.workerResult.stderr, "utf8"),
      stdoutOmitted: input.workerResult.stdout.length > 0,
      stderrOmitted: input.workerResult.stderr.length > 0,
      ...(wrappedWorkerModel(input.workerResult) === undefined
        ? { modelSource: wrappedWorkerDefaultModelSource(input.workerResult) }
        : {
            model: wrappedWorkerModel(input.workerResult),
            modelSource: "runstead_model_option"
          }),
      ...(input.checkpoint === undefined ? {} : { checkpointId: input.checkpoint.id }),
      ...(input.verifierResult === undefined
        ? {}
        : {
            verifiers: input.verifierResult.commandResults,
            verifierStatus: input.verifierResult.task.status
          })
    };
  }

  return {
    summary: input.summary,
    worker: input.workerResult.worker,
    model: input.workerResult.model,
    modelProvider: input.workerResult.modelProvider,
    status: input.workerResult.status,
    exitCode: input.workerResult.exitCode,
    toolCalls: input.workerResult.toolCalls,
    failedToolCalls: input.workerResult.failedToolCalls,
    workerRunId: input.workerResult.workerRun.id,
    governance: localNativeWorkerGovernanceOutput(),
    execution: localAgentExecutionSemantics(input),
    ...(input.workerResult.warnings.length === 0
      ? {}
      : { warnings: input.workerResult.warnings }),
    ...(input.workerResult.interruption === undefined
      ? {}
      : { interruption: input.workerResult.interruption }),
    ...(input.workerResult.budget === undefined
      ? {}
      : { budget: input.workerResult.budget }),
    ...(input.checkpoint === undefined ? {} : { checkpointId: input.checkpoint.id }),
    ...(input.verifierResult === undefined
      ? {}
      : {
          verifiers: input.verifierResult.commandResults,
          verifierStatus: input.verifierResult.task.status
        }),
    ...(input.workerResult.approval === undefined
      ? {}
      : { approval: input.workerResult.approval })
  };
}

export function localAgentWorkerOutput(input: {
  workerResult: LocalAgentWorkerResult;
  summary?: string;
  checkpoint?: WorkspaceCheckpoint;
  verifierResult?: RunTaskVerifiersResult;
}): JsonObject {
  if (!isCodexDirectLocalAgentWorkerResult(input.workerResult)) {
    return {
      worker: input.workerResult.worker,
      command: input.workerResult.command,
      args: redactedLocalWrappedWorkerArgs(input.workerResult),
      governance: localWrappedWorkerGovernanceOutput(input.workerResult),
      execution: localAgentExecutionSemantics(input),
      status: input.workerResult.exitCode === 0 ? "completed" : "failed",
      exitCode: input.workerResult.exitCode,
      outputValidation: input.workerResult.outputValidation,
      progress: input.workerResult.progress,
      stdoutBytes: Buffer.byteLength(input.workerResult.stdout, "utf8"),
      stderrBytes: Buffer.byteLength(input.workerResult.stderr, "utf8"),
      stdoutOmitted: input.workerResult.stdout.length > 0,
      stderrOmitted: input.workerResult.stderr.length > 0,
      ...(input.summary === undefined ? {} : { summary: input.summary }),
      ...(wrappedWorkerModel(input.workerResult) === undefined
        ? { modelSource: wrappedWorkerDefaultModelSource(input.workerResult) }
        : {
            model: wrappedWorkerModel(input.workerResult),
            modelSource: "runstead_model_option"
          }),
      ...(input.checkpoint === undefined ? {} : { checkpointId: input.checkpoint.id }),
      ...(input.verifierResult === undefined
        ? {}
        : {
            verifiers: input.verifierResult.commandResults,
            verifierStatus: input.verifierResult.task.status
          })
    };
  }

  return {
    worker: input.workerResult.worker,
    model: input.workerResult.model,
    modelProvider: input.workerResult.modelProvider,
    status: input.workerResult.status,
    exitCode: input.workerResult.exitCode,
    toolCalls: input.workerResult.toolCalls,
    failedToolCalls: input.workerResult.failedToolCalls,
    summary: input.summary ?? input.workerResult.summary,
    governance: localNativeWorkerGovernanceOutput(),
    execution: localAgentExecutionSemantics(input),
    ...(input.workerResult.warnings.length === 0
      ? {}
      : { warnings: input.workerResult.warnings }),
    ...(input.workerResult.interruption === undefined
      ? {}
      : { interruption: input.workerResult.interruption }),
    ...(input.workerResult.budget === undefined
      ? {}
      : { budget: input.workerResult.budget }),
    ...(input.checkpoint === undefined ? {} : { checkpointId: input.checkpoint.id }),
    ...(input.verifierResult === undefined
      ? {}
      : {
          verifiers: input.verifierResult.commandResults,
          verifierStatus: input.verifierResult.task.status
        })
  };
}

export function formatLocalAgentWorkerResultLines(
  workerResult: LocalAgentWorkerResult
): string[] {
  if (isCodexDirectLocalAgentWorkerResult(workerResult)) {
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

export function localAgentFailureFromError(
  error: unknown,
  checkpoint?: WorkspaceCheckpoint
): {
  taskStatus: Task["status"];
  workerStatus: "failed" | "waiting_approval" | "blocked";
  resultStatus:
    | "completed"
    | "completed_with_warnings"
    | "waiting_approval"
    | "interrupted"
    | "blocked"
    | "failed";
  output: JsonObject;
  execution: RuntimeExecutionSemantics;
  approval?: CodexDirectWorkerResult["approval"];
} {
  if (error instanceof ToolActionApprovalRequiredError) {
    const approval = {
      id: error.approval.id,
      actionId: error.approval.actionId,
      policyDecisionId: error.policyDecision.id,
      reason: error.approval.reason
    };

    return {
      taskStatus: "waiting_approval",
      workerStatus: "waiting_approval",
      resultStatus: "waiting_approval",
      output: {
        summary: error.message,
        execution: localAgentFailureExecution("approval_waiting"),
        ...(checkpoint === undefined ? {} : { checkpointId: checkpoint.id }),
        approval
      },
      execution: localAgentFailureExecution("approval_waiting"),
      approval
    };
  }

  if (error instanceof ToolActionDeniedError) {
    return {
      taskStatus: "blocked",
      workerStatus: "blocked",
      resultStatus: "blocked",
      output: {
        summary: error.message,
        execution: localAgentFailureExecution("blocked"),
        ...(checkpoint === undefined ? {} : { checkpointId: checkpoint.id })
      },
      execution: localAgentFailureExecution("blocked")
    };
  }

  const execution = localAgentFailureExecution("failed");

  return {
    taskStatus: "failed",
    workerStatus: "failed",
    resultStatus: "failed",
    output: {
      summary: error instanceof Error ? error.message : String(error),
      execution,
      ...(checkpoint === undefined ? {} : { checkpointId: checkpoint.id })
    },
    execution
  };
}

export function isCodexDirectLocalAgentWorkerResult(
  workerResult: LocalAgentWorkerResult
): workerResult is CodexDirectWorkerResult {
  return workerResult.worker === CODEX_DIRECT_WORKER_KIND;
}

export function localAgentWorkerCompleted(
  workerResult: LocalAgentWorkerResult
): boolean {
  return isCodexDirectLocalAgentWorkerResult(workerResult)
    ? workerResult.status === "completed" ||
        (workerResult.status === "failed" &&
          (workerResult.budget !== undefined ||
            workerResult.toolCalls > 0 ||
            workerResult.execution.verification !== "skipped"))
    : workerResult.exitCode === 0;
}

function localAgentEffectiveVerifierOutcome(
  workerResult: LocalAgentWorkerResult,
  verifierResult: RunTaskVerifiersResult | undefined
): RuntimeVerifierOutcome | undefined {
  const explicit = localAgentVerifierOutcome(verifierResult);

  if (explicit !== undefined) {
    return explicit;
  }

  if (
    isCodexDirectLocalAgentWorkerResult(workerResult) &&
    workerResult.execution.verification !== "skipped"
  ) {
    return { status: workerResult.execution.verification };
  }

  return undefined;
}

function localAgentWorkerOutcome(
  workerResult: LocalAgentWorkerResult
): RuntimeWorkerOutcome {
  if (!isCodexDirectLocalAgentWorkerResult(workerResult)) {
    return {
      kind: "wrapped",
      exitCode: workerResult.exitCode
    };
  }

  return {
    kind: "governed",
    status: workerResult.status,
    toolCalls: workerResult.toolCalls,
    ...(workerResult.budget === undefined ? {} : { budgetExhausted: true })
  };
}

function localAgentVerifierOutcome(
  verifierResult: RunTaskVerifiersResult | undefined
): RuntimeVerifierOutcome | undefined {
  if (verifierResult === undefined) {
    return undefined;
  }

  return {
    status: localAgentVerifiersPassed(verifierResult) ? "passed" : "failed",
    taskStatus: verifierResult.task.status
  };
}

function localAgentVerifiersPassed(
  verifierResult: RunTaskVerifiersResult | undefined
): boolean {
  return (
    verifierResult !== undefined &&
    verifierResult.commandResults.length > 0 &&
    verifierResult.commandResults.every(
      (result) => result.exitCode === 0 && result.timedOut === false
    )
  );
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

function localAgentFailureExecution(
  agentCompletion: RuntimeExecutionSemantics["agentCompletion"]
): RuntimeExecutionSemantics {
  return {
    implementation: "not_applied",
    verification: "skipped",
    agentCompletion
  };
}

function redactedLocalWrappedWorkerArgs(
  workerResult: WrappedWorkerRunResult
): string[] {
  const omitted = "[omitted from Runstead durable state]";

  return workerResult.args.map((arg) => (arg === workerResult.prompt ? omitted : arg));
}

function wrappedWorkerModel(workerResult: WrappedWorkerRunResult): string | undefined {
  const modelFlagIndex = workerResult.args.indexOf("--model");
  const model =
    modelFlagIndex === -1 ? undefined : workerResult.args[modelFlagIndex + 1];

  return typeof model === "string" && model.trim().length > 0
    ? model.trim()
    : undefined;
}

function wrappedWorkerModelSource(workerResult: WrappedWorkerRunResult): string {
  return wrappedWorkerModel(workerResult) === undefined
    ? wrappedWorkerDefaultModelSource(workerResult)
    : "runstead_model_option";
}

function wrappedWorkerDefaultModelSource(workerResult: WrappedWorkerRunResult): string {
  return workerResult.worker === "codex_cli"
    ? "codex_cli_config"
    : "claude_code_config";
}

function wrappedWorkerDefaultModelLabel(workerResult: WrappedWorkerRunResult): string {
  return workerResult.worker === "codex_cli"
    ? "Codex CLI default"
    : "Claude Code CLI default";
}

function localWrappedWorkerGovernanceOutput(
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

function localNativeWorkerGovernanceOutput(): JsonObject {
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
