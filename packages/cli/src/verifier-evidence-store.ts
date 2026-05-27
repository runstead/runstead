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
  commandVerifierEvidenceEventPayload,
  sanitizeVerifierArtifactName,
  type CommandVerifierArtifact
} from "./verifier-evidence-artifact.js";
import type { ShellCommandResult } from "./shell-executor.js";

export interface PersistCommandVerifierEvidenceInput {
  runsteadRoot: string;
  database: RunsteadDatabase;
  task: Task;
  command: CommandVerifierInput;
  artifact: CommandVerifierArtifact;
  result: ShellCommandResult;
  createdAt: string;
  evidenceType: "command_output" | "policy_decision";
  artifactSubject: "command_verifier" | "command_verifier_policy";
  summary: string;
  artifactSuffix?: string;
  payload?: JsonObject;
}

export interface PersistCommandVerifierEvidenceResult {
  evidence: Evidence;
  event: RunsteadEvent;
  artifactPath: string;
  artifactManifestPath: string;
}

export async function persistCommandVerifierEvidence(
  input: PersistCommandVerifierEvidenceInput
): Promise<PersistCommandVerifierEvidenceResult> {
  const runsteadRoot = resolve(input.runsteadRoot);
  const evidenceId = createRunsteadId("ev");
  const evidenceDir = join(runsteadRoot, "evidence");
  const artifactName = sanitizeVerifierArtifactName(input.command.name);
  const artifactPath = join(
    evidenceDir,
    [
      "verifier",
      artifactName,
      ...(input.artifactSuffix === undefined ? [] : [input.artifactSuffix]),
      evidenceId
    ].join("-") + ".json"
  );
  const artifactWrite = await writeJsonArtifactFile({
    artifactPath,
    value: input.artifact,
    createdAt: input.createdAt,
    metadata: {
      evidenceId,
      evidenceType: input.evidenceType,
      subject: input.artifactSubject
    }
  });
  const evidence: Evidence = {
    id: evidenceId,
    type: input.evidenceType,
    subjectType: "task",
    subjectId: input.task.id,
    uri: artifactWrite.artifactUri,
    hash: artifactWrite.sha256,
    summary: input.summary,
    createdAt: input.createdAt
  };
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "evidence.recorded",
    aggregateType: "evidence",
    aggregateId: evidence.id,
    payload: {
      ...commandVerifierEvidenceEventPayload(
        evidence,
        input.command.name,
        input.result
      ),
      ...(input.payload ?? {})
    },
    createdAt: input.createdAt
  };

  appendEventAndProject(input.database, {
    event,
    projection: {
      type: "evidence",
      value: evidence
    }
  });

  return {
    evidence,
    event,
    artifactPath,
    artifactManifestPath: artifactWrite.manifestPath
  };
}
