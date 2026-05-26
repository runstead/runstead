import type { Task } from "@runstead/core";
import type { RuntimeVerificationStatus } from "@runstead/runtime";

import { declaredVerifierCommands } from "./evidence-actions.js";
import { isRecord } from "./tool-arguments.js";
import type { CodexDirectToolCall } from "./tool-types.js";

export function codexDirectVerificationStatus(
  task: Task,
  verifierResults: Map<string, RuntimeVerificationStatus>
): RuntimeVerificationStatus {
  const declaredNames = declaredVerifierCommands(task).map((command) => command.name);

  if (declaredNames.length === 0 || verifierResults.size === 0) {
    return "skipped";
  }

  if (declaredNames.some((name) => verifierResults.get(name) === "failed")) {
    return "failed";
  }

  return declaredNames.every((name) => verifierResults.get(name) === "passed")
    ? "passed"
    : "skipped";
}

export function recordCodexDirectVerifierResult(input: {
  toolCall: CodexDirectToolCall;
  toolResult: { output: string; failed: boolean };
  verifierResults: Map<string, RuntimeVerificationStatus>;
}): void {
  if (input.toolCall.name !== "run_verifier" || input.toolResult.failed) {
    return;
  }

  const parsed = safeJsonObject(input.toolResult.output);
  if (parsed === undefined) {
    return;
  }

  const verifier = typeof parsed.verifier === "string" ? parsed.verifier : undefined;

  if (verifier === undefined) {
    return;
  }

  input.verifierResults.set(
    verifier,
    parsed.exitCode === 0 && parsed.timedOut === false ? "passed" : "failed"
  );
}

export function safeJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;

    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function codexDirectWarningOptions(
  warnings: string[] | undefined
): { warnings: string[] } | object {
  return warnings === undefined ? {} : { warnings };
}
