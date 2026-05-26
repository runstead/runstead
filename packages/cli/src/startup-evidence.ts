import { join, resolve } from "node:path";

import {
  createRunsteadId,
  type Evidence,
  type JsonObject,
  type RunsteadEvent
} from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { writeJsonArtifactFile } from "./artifact-store.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  parseStartupEvidenceType,
  validateStartupEvidenceContent,
  type StartupEvidenceType,
  type StartupGateStage,
  type StartupHypothesisKind,
  type StartupHypothesisStatus
} from "./startup-evidence-types.js";
import {
  normalizeStartupEvidenceSources,
  startupEvidenceProvenance,
  type StartupEvidenceSource,
  type StartupEvidenceSourceInput
} from "./startup-evidence-sources.js";
import {
  startupEvidenceEventPayload,
  startupEvidenceRemediation,
  startupEvidenceSubject
} from "./startup-evidence-artifact.js";

export type {
  StartupEvidenceSource,
  StartupEvidenceSourceInput
} from "./startup-evidence-sources.js";
export {
  STARTUP_EVIDENCE_TYPES,
  parseStartupHypothesisStatusValue
} from "./startup-evidence-types.js";
export type {
  StartupEvidenceType,
  StartupGateStage,
  StartupHypothesisKind,
  StartupHypothesisStatus
} from "./startup-evidence-types.js";
export { STARTUP_GATE_RULES } from "./startup-gate-rules.js";
export type {
  StartupGateFindingSeverity,
  StartupGateRule
} from "./startup-gate-rules.js";
export type {
  StartupGateDiff,
  StartupGateFinding,
  StartupGateWaiver
} from "./startup-gate-evaluation.js";
export { formatStartupGateCheckResult } from "./startup-gate-format.js";
export { checkStartupGate } from "./startup-gate-check.js";
export type {
  CheckStartupGateOptions,
  StartupGateCheckResult
} from "./startup-gate-check.js";

export interface AddStartupEvidenceOptions {
  cwd?: string;
  type: string;
  summary: string;
  sourceRefs?: string[];
  sources?: StartupEvidenceSourceInput[];
  content?: string;
  goalId?: string;
  hypothesisId?: string;
  decisionId?: string;
  gate?: StartupGateStage;
  blocker?: string;
  owner?: string;
  remediationTask?: string;
  acceptanceCriteria?: string;
  now?: Date;
}

export interface AddStartupEvidenceResult {
  root: string;
  stateDb: string;
  evidence: Evidence;
  event: RunsteadEvent;
  artifact: StartupEvidenceArtifact;
  artifactPath: string;
  artifactManifestPath: string;
}

export interface AddStartupHypothesisOptions {
  cwd?: string;
  kind: StartupHypothesisKind;
  statement: string;
  status?: StartupHypothesisStatus;
  sourceRefs?: string[];
  goalId?: string;
  now?: Date;
}

export interface RecordStartupManualChangeOptions {
  cwd?: string;
  operator: string;
  reason: string;
  diffSummary: string;
  filesTouched?: string[];
  commandsRerun?: string[];
  evidenceRefs?: string[];
  sourceRefs?: string[];
  goalId?: string;
  gate?: StartupGateStage;
  blocker?: string;
  now?: Date;
}

export interface StartupEvidenceArtifact {
  schemaVersion: 1;
  createdAt: string;
  evidenceType: StartupEvidenceType;
  summary: string;
  sourceRefs: string[];
  sources: StartupEvidenceSource[];
  provenance: JsonObject;
  associations: {
    goalId?: string;
    hypothesisId?: string;
    decisionId?: string;
    gate?: StartupGateStage;
    blocker?: string;
  };
  remediation?: {
    owner: string;
    task: string;
    acceptanceCriteria: string;
  };
  content?: string;
}

export interface RecordStartupGateDecisionOptions {
  cwd?: string;
  domain?: string;
  stage: StartupGateStage;
  decision: "launch" | "no_launch" | "launch_with_accepted_debt" | "waive_blocker";
  reason: string;
  comment?: string;
  owner?: string;
  blocker?: string;
  expiresAt?: string;
  now?: Date;
}

const STARTUP_DOMAIN = "ai-native-startup";

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

export async function addStartupHypothesis(
  options: AddStartupHypothesisOptions
): Promise<AddStartupEvidenceResult> {
  return addStartupEvidence({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    type: `${options.kind}_hypothesis`,
    summary: `${options.kind} hypothesis: ${options.statement}`,
    sourceRefs: options.sourceRefs ?? [],
    content: JSON.stringify(
      {
        kind: options.kind,
        statement: options.statement,
        status: options.status ?? "open"
      },
      null,
      2
    ),
    ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
}

export async function recordStartupManualChange(
  options: RecordStartupManualChangeOptions
): Promise<AddStartupEvidenceResult> {
  const content = {
    changeSource: "operator",
    actor: options.operator,
    reason: options.reason,
    diffSummary: options.diffSummary,
    filesTouched: options.filesTouched ?? [],
    commandsRerun: options.commandsRerun ?? [],
    evidenceRefs: options.evidenceRefs ?? []
  };

  return addStartupEvidence({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    type: "manual_change",
    summary: `Operator ${options.operator}: ${options.diffSummary}`,
    sourceRefs: options.sourceRefs ?? [],
    sources: [
      {
        kind: "manual",
        uri: `operator:${options.operator}`,
        ...(options.now === undefined ? {} : { capturedAt: options.now.toISOString() }),
        trustLevel: "medium",
        provenance: {
          reason: options.reason
        }
      }
    ],
    content: JSON.stringify(content, null, 2),
    ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
    ...(options.gate === undefined ? {} : { gate: options.gate }),
    ...(options.blocker === undefined ? {} : { blocker: options.blocker }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
}

export async function recordStartupGateDecision(
  options: RecordStartupGateDecisionOptions
): Promise<AddStartupEvidenceResult> {
  const isWaiver = options.decision === "waive_blocker";

  if (isWaiver) {
    if (options.blocker === undefined || options.blocker.trim().length === 0) {
      throw new Error("gate waiver requires a blocker");
    }

    if (options.owner === undefined || options.owner.trim().length === 0) {
      throw new Error("gate waiver requires an owner");
    }

    if (
      options.expiresAt === undefined ||
      Number.isNaN(Date.parse(options.expiresAt))
    ) {
      throw new Error("gate waiver requires a valid expiresAt timestamp");
    }
  }

  return addStartupEvidence({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    type: "decision",
    summary: isWaiver
      ? `Waived ${options.stage} blocker: ${options.blocker}`
      : `Startup ${options.stage} decision: ${options.decision}`,
    gate: options.stage,
    ...(options.blocker === undefined ? {} : { blocker: options.blocker }),
    content: JSON.stringify(
      {
        kind: isWaiver ? "gate_waiver" : "release_decision",
        domain: options.domain ?? STARTUP_DOMAIN,
        gate: options.stage,
        decision: options.decision,
        reason: options.reason,
        ...(options.comment === undefined ? {} : { comment: options.comment }),
        ...(options.owner === undefined ? {} : { owner: options.owner }),
        ...(options.blocker === undefined ? {} : { blocker: options.blocker }),
        ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt })
      },
      null,
      2
    ),
    ...(options.now === undefined ? {} : { now: options.now })
  });
}
