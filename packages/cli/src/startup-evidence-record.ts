import { join, resolve } from "node:path";

import { createRunsteadId, type Evidence, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { writeJsonArtifactFile } from "./artifact-store.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  parseStartupEvidenceType,
  validateStartupEvidenceContent
} from "./startup-evidence-types.js";
import {
  normalizeStartupEvidenceSources,
  startupEvidenceProvenance
} from "./startup-evidence-sources.js";
import {
  startupEvidenceEventPayload,
  startupEvidenceRemediation,
  startupEvidenceSubject
} from "./startup-evidence-artifact.js";
import type {
  AddStartupEvidenceOptions,
  AddStartupEvidenceResult,
  StartupEvidenceArtifact
} from "./startup-evidence-record-types.js";

export type * from "./startup-evidence-record-types.js";
export {
  addStartupHypothesis,
  recordStartupGateDecision,
  recordStartupManualChange
} from "./startup-evidence-convenience.js";

export async function addStartupEvidence(
  options: AddStartupEvidenceOptions
): Promise<AddStartupEvidenceResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedState = await requireRunsteadStateDb(cwd);
  const createdAt = (options.now ?? new Date()).toISOString();
  const evidenceType = parseStartupEvidenceType(options.type);
  validateStartupEvidenceContent(evidenceType, options.content);
  const evidenceId = createRunsteadId("ev");
  const sources = normalizeStartupEvidenceSources({
    createdAt,
    sourceRefs: options.sourceRefs ?? [],
    sources: options.sources ?? []
  });
  const remediation = startupEvidenceRemediation(options);
  const artifact: StartupEvidenceArtifact = {
    schemaVersion: 1,
    createdAt,
    evidenceType,
    summary: options.summary,
    sourceRefs: options.sourceRefs ?? [],
    sources,
    provenance: startupEvidenceProvenance({ createdAt, sources }),
    associations: {
      ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
      ...(options.hypothesisId === undefined
        ? {}
        : { hypothesisId: options.hypothesisId }),
      ...(options.decisionId === undefined ? {} : { decisionId: options.decisionId }),
      ...(options.gate === undefined ? {} : { gate: options.gate }),
      ...(options.blocker === undefined ? {} : { blocker: options.blocker })
    },
    ...(remediation === undefined ? {} : { remediation }),
    ...(options.content === undefined ? {} : { content: options.content })
  };
  const evidenceDir = join(resolvedState.root, "evidence");
  const artifactPath = join(evidenceDir, `startup-${evidenceType}-${evidenceId}.json`);
  const artifactWrite = await writeJsonArtifactFile({
    artifactPath,
    value: artifact,
    createdAt,
    metadata: {
      evidenceId,
      evidenceType: `startup_${evidenceType}`,
      subject: "startup_evidence"
    }
  });
  const subject = startupEvidenceSubject(artifact);
  const evidence: Evidence = {
    id: evidenceId,
    type: `startup_${evidenceType}`,
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    uri: artifactWrite.artifactUri,
    hash: artifactWrite.sha256,
    summary: options.summary,
    createdAt
  };
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "evidence.recorded",
    aggregateType: "evidence",
    aggregateId: evidence.id,
    payload: startupEvidenceEventPayload(evidence, artifact),
    createdAt
  };
  const database = openRunsteadDatabase(resolvedState.stateDb);

  try {
    appendEventAndProject(database, {
      event,
      projection: {
        type: "evidence",
        value: evidence
      }
    });
  } finally {
    database.close();
  }

  return {
    root: resolvedState.root,
    stateDb: resolvedState.stateDb,
    evidence,
    event,
    artifact,
    artifactPath,
    artifactManifestPath: artifactWrite.manifestPath
  };
}
