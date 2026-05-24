import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

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
import { runShellCommand, type ShellCommandResult } from "./shell-executor.js";

export type { CommandVerifierInput } from "@runstead/verifiers";

const execFileAsync = promisify(execFile);

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

export interface CommandVerifierCodeState {
  kind: "git_workspace";
  available: boolean;
  headState: "committed" | "unborn" | "unknown";
  gitHead?: string;
  dirty: boolean;
  statusHash: string;
  fileSetHash: string;
  fingerprint: string;
  changedFiles: CommandVerifierChangedFile[];
}

export interface CommandVerifierChangedFile {
  path: string;
  status: string;
  hash?: string;
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

export async function collectCommandVerifierCodeState(
  cwd: string
): Promise<CommandVerifierCodeState> {
  const insideWorkTree = await gitOutput(cwd, [
    "rev-parse",
    "--is-inside-work-tree"
  ]);
  const gitHead = await gitOutput(cwd, ["rev-parse", "--verify", "HEAD"]);
  const statusOutput = await gitOutput(cwd, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all"
  ]);

  if (insideWorkTree?.trim() !== "true" || statusOutput === undefined) {
    const fallback = sha256(`nogit:${cwd}`);

    return {
      kind: "git_workspace",
      available: false,
      headState: "unknown",
      dirty: false,
      statusHash: fallback,
      fileSetHash: fallback,
      fingerprint: fallback,
      changedFiles: []
    };
  }

  const changedFiles = await Promise.all(
    parseGitPorcelainStatus(statusOutput)
      .filter((entry) => !isRunsteadInternalPath(entry.path))
      .map(async (entry) => ({
        ...entry,
        ...(await fileHash(cwd, entry.path))
      }))
  );
  const statusHash = sha256(statusOutput);
  const fileSetHash = sha256(JSON.stringify(changedFiles));
  const normalizedGitHead = gitHead?.trim();
  const headState = normalizedGitHead === undefined ? "unborn" : "committed";
  const fingerprint = sha256(
    JSON.stringify({
      gitHead: normalizedGitHead ?? "unborn",
      headState,
      statusHash,
      fileSetHash
    })
  );

  return {
    kind: "git_workspace",
    available: true,
    headState,
    ...(normalizedGitHead === undefined ? {} : { gitHead: normalizedGitHead }),
    dirty: changedFiles.length > 0,
    statusHash,
    fileSetHash,
    fingerprint,
    changedFiles
  };
}

async function gitOutput(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });

    return stdout;
  } catch {
    return undefined;
  }
}

function parseGitPorcelainStatus(output: string): CommandVerifierChangedFile[] {
  return output
    .split("\0")
    .filter((entry) => entry.length > 0)
    .flatMap((entry) => {
      const status = entry.slice(0, 2);
      const path = entry.slice(3);

      if (path.length === 0) {
        return [];
      }

      return [
        {
          status,
          path
        }
      ];
    });
}

function isRunsteadInternalPath(path: string): boolean {
  return path === ".runstead" || path.startsWith(".runstead/");
}

async function fileHash(cwd: string, relativePath: string): Promise<{ hash?: string }> {
  const absolutePath = resolve(cwd, relativePath);

  try {
    const fileStat = await stat(absolutePath);

    if (!fileStat.isFile()) {
      return {};
    }

    return {
      hash: sha256(await readFile(absolutePath))
    };
  } catch {
    return {};
  }
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

function sha256(contents: string | Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

function sanitizeArtifactName(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, "_");

  return sanitized.length === 0 ? "unnamed" : sanitized;
}
