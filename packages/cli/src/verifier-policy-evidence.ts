import { resolve } from "node:path";

import type { Task } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";
import type { CommandVerifierInput } from "@runstead/verifiers";

import {
  createCommandVerifierArtifact,
  deniedCommandVerifierResult,
  type CommandVerifierArtifact
} from "./verifier-evidence-artifact.js";
import {
  persistCommandVerifierEvidence,
  type PersistCommandVerifierEvidenceResult
} from "./verifier-evidence-store.js";
import { collectCommandVerifierCodeState } from "./verifier-code-state.js";

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

export type StoreCommandVerifierPolicyEvidenceResult =
  PersistCommandVerifierEvidenceResult & {
    artifact: CommandVerifierArtifact;
  };

export async function storeCommandVerifierPolicyEvidence(
  options: StoreCommandVerifierPolicyEvidenceOptions
): Promise<StoreCommandVerifierPolicyEvidenceResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const createdAt = (options.now ?? new Date()).toISOString();
  const codeState = await collectCommandVerifierCodeState(cwd);
  const result = deniedCommandVerifierResult({
    cwd,
    command: options.command
  });
  const artifact = createCommandVerifierArtifact({
    createdAt,
    task: options.task,
    command: options.command,
    codeState,
    result,
    policy: {
      policyDecisionId: options.policyDecisionId,
      decision: options.decision,
      reason: options.reason,
      ...(options.approvalId === undefined ? {} : { approvalId: options.approvalId })
    }
  });
  const persisted = await persistCommandVerifierEvidence({
    runsteadRoot: options.runsteadRoot,
    database: options.database,
    task: options.task,
    command: options.command,
    artifact,
    result,
    createdAt,
    summary: `${options.command.name}: ${options.decision} by policy`,
    evidenceType: "policy_decision",
    artifactSubject: "command_verifier_policy",
    artifactSuffix: options.decision,
    payload: {
      policyDecisionId: options.policyDecisionId,
      decision: options.decision,
      ...(options.approvalId === undefined ? {} : { approvalId: options.approvalId })
    }
  });

  return {
    evidence: persisted.evidence,
    event: persisted.event,
    artifact,
    artifactPath: persisted.artifactPath,
    artifactManifestPath: persisted.artifactManifestPath
  };
}
