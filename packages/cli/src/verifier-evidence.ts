import { resolve } from "node:path";

import type { Evidence, RunsteadEvent, Task } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";
import type { CommandVerifierInput } from "@runstead/verifiers";

import {
  createCommandVerifierArtifact,
  summarizeCommandResult,
  type CommandVerifierArtifact
} from "./verifier-evidence-artifact.js";
import { persistCommandVerifierEvidence } from "./verifier-evidence-store.js";
import { collectCommandVerifierCodeState } from "./verifier-code-state.js";
import { runShellCommand } from "./shell-executor.js";

export type { CommandVerifierInput } from "@runstead/verifiers";
export { collectCommandVerifierCodeState } from "./verifier-code-state.js";
export type {
  CommandVerifierChangedFile,
  CommandVerifierCodeState
} from "./verifier-code-state.js";
export type { CommandVerifierArtifact } from "./verifier-evidence-artifact.js";
export {
  storeCommandVerifierPolicyEvidence,
  type StoreCommandVerifierPolicyEvidenceOptions,
  type StoreCommandVerifierPolicyEvidenceResult
} from "./verifier-policy-evidence.js";

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
  const createdAt = (options.now ?? new Date()).toISOString();
  const codeState = await collectCommandVerifierCodeState(cwd);
  const result = await runShellCommand({
    command: options.command.command,
    cwd,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.killGraceMs === undefined ? {} : { killGraceMs: options.killGraceMs })
  });
  const artifact = createCommandVerifierArtifact({
    createdAt,
    task: options.task,
    command: options.command,
    codeState,
    result
  });
  const persisted = await persistCommandVerifierEvidence({
    runsteadRoot: options.runsteadRoot,
    database: options.database,
    task: options.task,
    command: options.command,
    artifact,
    result,
    createdAt,
    summary: summarizeCommandResult(options.command.name, result),
    evidenceType: "command_output",
    artifactSubject: "command_verifier"
  });

  return {
    evidence: persisted.evidence,
    event: persisted.event,
    artifact,
    artifactPath: persisted.artifactPath,
    artifactManifestPath: persisted.artifactManifestPath
  };
}
