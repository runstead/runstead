import type { JsonObject, Task } from "@runstead/core";

import type {
  CodexDirectBudgetSummary,
  CodexDirectInterruptionSummary
} from "./codex-direct-worker.js";
import { budgetDiagnostic } from "./local-agent-budget-diagnostics.js";
import type { LocalAgentDiagnostic } from "./local-agent-diagnostic-types.js";
import {
  approvalFromOutput,
  budgetFromOutput,
  interruptionFromOutput,
  isFailedVerifierOutput,
  numberOutput,
  outputString,
  stringOutput
} from "./local-agent-diagnostic-output.js";
import type { RunTaskVerifierCommandResult } from "./verifier-runner.js";

export type { LocalAgentDiagnostic } from "./local-agent-diagnostic-types.js";

export interface LocalAgentRunDiagnosticInput {
  task: Task;
  status: string;
  summary: string;
  workerResult?:
    | {
        failedToolCalls?: number;
        warnings?: string[];
        budget?: CodexDirectBudgetSummary;
        interruption?: CodexDirectInterruptionSummary;
        status?: string;
      }
    | undefined;
  verifierResults?: RunTaskVerifierCommandResult[] | undefined;
  approval?:
    | {
        id: string;
        reason: string;
      }
    | undefined;
}

export function diagnoseLocalAgentRun(
  input: LocalAgentRunDiagnosticInput
): LocalAgentDiagnostic[] {
  const workerStatus = input.workerResult?.status ?? input.status;

  return compactDiagnostics([
    approvalDiagnostic(input.task.id, input.approval),
    interruptionDiagnostic(input.workerResult?.interruption),
    budgetDiagnostic(input.workerResult?.budget),
    verifierDiagnostic(input.verifierResults),
    policyDeniedDiagnostic(input.status, input.summary),
    codexAuthDiagnostic(workerStatus, input.summary),
    codexModelDiagnostic(workerStatus, input.summary),
    failedToolCallsDiagnostic(input.workerResult?.failedToolCalls)
  ]);
}

export function diagnoseLocalAgentTask(task: Task): LocalAgentDiagnostic[] {
  const output = task.output ?? {};
  const workerStatus = stringOutput(output, "status") || task.status;

  return compactDiagnostics([
    approvalDiagnostic(task.id, approvalFromOutput(output)),
    interruptionDiagnostic(interruptionFromOutput(output.interruption)),
    budgetDiagnostic(budgetFromOutput(output.budget)),
    verifierOutputDiagnostic(output),
    policyDeniedDiagnostic(task.status, stringOutput(output, "summary")),
    codexAuthDiagnostic(workerStatus, stringOutput(output, "summary")),
    codexModelDiagnostic(workerStatus, stringOutput(output, "summary")),
    failedToolCallsDiagnostic(numberOutput(output, "failedToolCalls"))
  ]);
}

export function formatLocalAgentDiagnostics(
  diagnostics: LocalAgentDiagnostic[]
): string[] {
  if (diagnostics.length === 0) {
    return [];
  }

  return [
    "Diagnosis:",
    ...diagnostics.flatMap((diagnostic) => [
      `- Cause: ${diagnostic.cause}`,
      ...(diagnostic.likelyReason === undefined
        ? []
        : [`  Likely reason: ${diagnostic.likelyReason}`]),
      ...(diagnostic.retry === undefined ? [] : [`  Retry: ${diagnostic.retry}`])
    ])
  ];
}

function approvalDiagnostic(
  taskId: string,
  approval: { id: string; reason: string } | undefined
): LocalAgentDiagnostic | undefined {
  return approval === undefined
    ? undefined
    : {
        cause: `approval required (${approval.id}): ${approval.reason}`,
        likelyReason: "A governed action needs explicit local approval.",
        retry: `runstead approval approve ${approval.id} && runstead agent resume ${taskId}`
      };
}

function interruptionDiagnostic(
  interruption: CodexDirectInterruptionSummary | undefined
): LocalAgentDiagnostic | undefined {
  if (interruption === undefined) {
    return undefined;
  }

  return {
    cause: `interrupted:${interruption.reason}`,
    likelyReason:
      "The Codex Direct model request exceeded its configured response timeout while Runstead stayed alive.",
    retry: interruption.retryCommand
  };
}

function verifierDiagnostic(
  results: RunTaskVerifierCommandResult[] | undefined
): LocalAgentDiagnostic | undefined {
  const failed = results?.find((result) => result.exitCode !== 0 || result.timedOut);

  return failed === undefined
    ? undefined
    : {
        cause: `verifier failed: ${failed.verifier} exit=${failed.exitCode ?? "unknown"} evidence=${failed.evidenceId}`,
        likelyReason: "The model completed, but Runstead verification did not pass.",
        retry: `inspect evidence ${failed.evidenceId}, fix the failure, then rerun the verifier`
      };
}

function verifierOutputDiagnostic(
  output: JsonObject
): LocalAgentDiagnostic | undefined {
  if (stringOutput(output, "verifierStatus") !== "failed") {
    return undefined;
  }

  const verifiers: unknown = output.verifiers;
  const failed = Array.isArray(verifiers)
    ? verifiers.find(isFailedVerifierOutput)
    : undefined;

  if (failed === undefined) {
    return {
      cause: "verifier failed",
      likelyReason: "The model completed, but Runstead verification did not pass."
    };
  }

  const exitCode = outputString(failed.exitCode, "unknown");
  const evidenceId = outputString(failed.evidenceId, "unknown");

  return {
    cause: `verifier failed: ${failed.verifier} exit=${exitCode} evidence=${evidenceId}`,
    likelyReason: "The model completed, but Runstead verification did not pass.",
    retry: `inspect evidence ${evidenceId}`
  };
}

function policyDeniedDiagnostic(
  status: string,
  summary: string
): LocalAgentDiagnostic | undefined {
  const normalized = summary.toLowerCase();

  return status === "blocked" || normalized.includes("denied")
    ? {
        cause: summary.length === 0 ? "policy denied the requested action" : summary,
        likelyReason: "A Runstead policy rule denied a tool or worker action.",
        retry: "adjust the prompt scope, allowed paths, or repo-maintenance policy"
      }
    : undefined;
}

function codexAuthDiagnostic(
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

function codexModelDiagnostic(
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

function failedToolCallsDiagnostic(
  failedToolCalls: number | undefined
): LocalAgentDiagnostic | undefined {
  return failedToolCalls === undefined || failedToolCalls === 0
    ? undefined
    : {
        cause: `completed with ${failedToolCalls} recoverable failed tool call${failedToolCalls === 1 ? "" : "s"}`,
        likelyReason:
          "At least one tool returned an error such as a missing file or invalid argument.",
        retry: "review the failed tool-call audit entries before trusting the summary"
      };
}

function compactDiagnostics(
  diagnostics: (LocalAgentDiagnostic | undefined)[]
): LocalAgentDiagnostic[] {
  const seen = new Set<string>();
  const compacted: LocalAgentDiagnostic[] = [];

  for (const diagnostic of diagnostics) {
    if (diagnostic === undefined || seen.has(diagnostic.cause)) {
      continue;
    }
    seen.add(diagnostic.cause);
    compacted.push(diagnostic);
  }

  return compacted;
}
