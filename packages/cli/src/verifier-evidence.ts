import { join, resolve } from "node:path";

import {
  createRunsteadId,
  type Evidence,
  type JsonObject,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import { appendEventAndProject, type RunsteadDatabase } from "@runstead/state-sqlite";
import type { CommandVerifierInput } from "@runstead/verifiers";

import { writeJsonArtifactFile } from "./artifact-store.js";
import {
  collectCommandVerifierCodeState,
  type CommandVerifierCodeState
} from "./verifier-code-state.js";
import { runShellCommand, type ShellCommandResult } from "./shell-executor.js";

export type { CommandVerifierInput } from "@runstead/verifiers";
export { collectCommandVerifierCodeState } from "./verifier-code-state.js";
export type {
  CommandVerifierChangedFile,
  CommandVerifierCodeState
} from "./verifier-code-state.js";

export interface StoreCommandVerifierEvidenceOptions {
  cwd?: string;
  runsteadRoot: string;
  database: RunsteadDatabase;
  task: Task;
  command: CommandVerifierInput;
  timeoutMs?: number;
  killGraceMs?: number;
  now?: Date;
}

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

export interface StoreCommandVerifierEvidenceResult {
  evidence: Evidence;
  event: RunsteadEvent;
  artifact: CommandVerifierArtifact;
  artifactPath: string;
  artifactManifestPath: string;
}

export async function storeCommandVerifierEvidence(
  options: StoreCommandVerifierEvidenceOptions
): Promise<StoreCommandVerifierEvidenceResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const runsteadRoot = resolve(options.runsteadRoot);
  const createdAt = (options.now ?? new Date()).toISOString();
  const codeState = await collectCommandVerifierCodeState(cwd);
  const result = await runShellCommand({
    command: options.command.command,
    cwd,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.killGraceMs === undefined ? {} : { killGraceMs: options.killGraceMs })
  });
  const artifact: CommandVerifierArtifact = {
    schemaVersion: 1,
    createdAt,
    taskId: options.task.id,
    goalId: options.task.goalId,
    verifier: options.command.name,
    command: result.command,
    codeState,
    result
  };
  const evidenceId = createRunsteadId("ev");
  const evidenceDir = join(runsteadRoot, "evidence");
  const artifactName = sanitizeArtifactName(options.command.name);
  const artifactPath = join(evidenceDir, `verifier-${artifactName}-${evidenceId}.json`);
  const artifactWrite = await writeJsonArtifactFile({
    artifactPath,
    value: artifact,
    createdAt,
    metadata: {
      evidenceId,
      evidenceType: "command_output",
      subject: "command_verifier"
    }
  });
  const evidence: Evidence = {
    id: evidenceId,
    type: "command_output",
    subjectType: "task",
    subjectId: options.task.id,
    uri: artifactWrite.artifactUri,
    hash: artifactWrite.sha256,
    summary: summarizeCommandResult(options.command.name, result),
    createdAt
  };
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "evidence.recorded",
    aggregateType: "evidence",
    aggregateId: evidence.id,
    payload: evidenceEventPayload(evidence, options.command.name, result),
    createdAt
  };

  appendEventAndProject(options.database, {
    event,
    projection: {
      type: "evidence",
      value: evidence
    }
  });

  return {
    evidence,
    event,
    artifact,
    artifactPath,
    artifactManifestPath: artifactWrite.manifestPath
  };
}

export interface StoreCommandVerifierPolicyEvidenceOptions {
  cwd?: string;
  runsteadRoot: string;
  database: RunsteadDatabase;
  task: Task;
  command: CommandVerifierInput;
  policyDecisionId: string;
  decision: "deny" | "require_approval";
  reason: string;
  approvalId?: string;
  now?: Date;
}

export async function storeCommandVerifierPolicyEvidence(
  options: StoreCommandVerifierPolicyEvidenceOptions
): Promise<StoreCommandVerifierEvidenceResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const runsteadRoot = resolve(options.runsteadRoot);
  const createdAt = (options.now ?? new Date()).toISOString();
  const codeState = await collectCommandVerifierCodeState(cwd);
  const result: ShellCommandResult = {
    command: options.command.command,
    cwd,
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
  const artifact: CommandVerifierArtifact = {
    schemaVersion: 1,
    createdAt,
    taskId: options.task.id,
    goalId: options.task.goalId,
    verifier: options.command.name,
    command: options.command.command,
    codeState,
    result,
    policy: {
      policyDecisionId: options.policyDecisionId,
      decision: options.decision,
      reason: options.reason,
      ...(options.approvalId === undefined ? {} : { approvalId: options.approvalId })
    }
  };
  const evidenceId = createRunsteadId("ev");
  const evidenceDir = join(runsteadRoot, "evidence");
  const artifactName = sanitizeArtifactName(options.command.name);
  const artifactPath = join(
    evidenceDir,
    `verifier-${artifactName}-${options.decision}-${evidenceId}.json`
  );
  const artifactWrite = await writeJsonArtifactFile({
    artifactPath,
    value: artifact,
    createdAt,
    metadata: {
      evidenceId,
      evidenceType: "policy_decision",
      subject: "command_verifier_policy"
    }
  });
  const evidence: Evidence = {
    id: evidenceId,
    type: "policy_decision",
    subjectType: "task",
    subjectId: options.task.id,
    uri: artifactWrite.artifactUri,
    hash: artifactWrite.sha256,
    summary: `${options.command.name}: ${options.decision} by policy`,
    createdAt
  };
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "evidence.recorded",
    aggregateType: "evidence",
    aggregateId: evidence.id,
    payload: {
      ...evidenceEventPayload(evidence, options.command.name, result),
      policyDecisionId: options.policyDecisionId,
      decision: options.decision,
      ...(options.approvalId === undefined ? {} : { approvalId: options.approvalId })
    },
    createdAt
  };

  appendEventAndProject(options.database, {
    event,
    projection: {
      type: "evidence",
      value: evidence
    }
  });

  return {
    evidence,
    event,
    artifact,
    artifactPath,
    artifactManifestPath: artifactWrite.manifestPath
  };
}

function summarizeCommandResult(
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

function evidenceEventPayload(
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

function sanitizeArtifactName(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, "_");

  return sanitized.length === 0 ? "unnamed" : sanitized;
}
