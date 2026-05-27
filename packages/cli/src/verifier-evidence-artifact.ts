import type { Evidence, JsonObject, Task } from "@runstead/core";
import type { CommandVerifierInput } from "@runstead/verifiers";

import type { ShellCommandResult } from "./shell-executor.js";
import type { CommandVerifierCodeState } from "./verifier-code-state.js";

export interface CommandVerifierArtifact {
  schemaVersion: 1;
  createdAt: string;
  taskId: string;
  goalId: string;
  verifier: string;
  command: string;
  codeState: CommandVerifierCodeState;
  result: ShellCommandResult;
  policy?: JsonObject;
}

export function createCommandVerifierArtifact(input: {
  createdAt: string;
  task: Task;
  command: CommandVerifierInput;
  codeState: CommandVerifierCodeState;
  result: ShellCommandResult;
  policy?: JsonObject;
}): CommandVerifierArtifact {
  return {
    schemaVersion: 1,
    createdAt: input.createdAt,
    taskId: input.task.id,
    goalId: input.task.goalId,
    verifier: input.command.name,
    command: input.result.command,
    codeState: input.codeState,
    result: input.result,
    ...(input.policy === undefined ? {} : { policy: input.policy })
  };
}

export function deniedCommandVerifierResult(input: {
  cwd: string;
  command: CommandVerifierInput;
}): ShellCommandResult {
  return {
    command: input.command.command,
    cwd: input.cwd,
    exitCode: null,
    signal: null,
    durationMs: 0,
    timedOut: false,
    forceKilled: false,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false
  };
}

export function summarizeCommandResult(
  verifierName: string,
  result: ShellCommandResult
): string {
  const status =
    result.exitCode === 0 && !result.timedOut
      ? "passed"
      : result.timedOut
        ? "timed out"
        : `failed with exit ${result.exitCode ?? "unknown"}`;

  return `${verifierName}: ${status}`;
}

export function commandVerifierEvidenceEventPayload(
  evidence: Evidence,
  verifierName: string,
  result: ShellCommandResult
): JsonObject {
  return {
    evidenceId: evidence.id,
    evidenceType: evidence.type,
    taskId: evidence.subjectId,
    verifier: verifierName,
    uri: evidence.uri,
    hash: evidence.hash,
    summary: evidence.summary,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    forceKilled: result.forceKilled,
    durationMs: result.durationMs
  };
}

export function sanitizeVerifierArtifactName(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, "_");

  return sanitized.length === 0 ? "unnamed" : sanitized;
}
