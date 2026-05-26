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
import { readStartupGateEvidenceArtifacts } from "./startup-gate-artifact-store.js";
import {
  parseStartupEvidenceType,
  validateStartupEvidenceContent,
  type StartupEvidenceType,
  type StartupGateStage,
  type StartupHypothesisKind,
  type StartupHypothesisStatus
} from "./startup-evidence-types.js";
import { hasNonEmptyString, isRecord } from "./startup-gate-artifacts.js";
import {
  normalizeStartupEvidenceSources,
  startupEvidenceProvenance,
  type StartupEvidenceSource,
  type StartupEvidenceSourceInput
} from "./startup-evidence-sources.js";
import {
  evaluateStartupGate,
  type StartupGateDiff,
  type StartupGateEvidenceRow,
  type StartupGateFinding,
  type StartupGatePreviousEvent,
  type StartupGateTaskRow,
  type StartupGateWaiver
} from "./startup-gate-evaluation.js";

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

export interface CheckStartupGateOptions {
  cwd?: string;
  domain?: string;
  stage?: StartupGateStage;
  now?: Date;
  recordEvent?: boolean;
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

export interface StartupGateCheckResult {
  root: string;
  stateDb: string;
  domain: string;
  stage: StartupGateStage;
  passed: boolean;
  blockers: string[];
  warnings: string[];
  findings: StartupGateFinding[];
  waivedBlockers: StartupGateWaiver[];
  diff: StartupGateDiff;
  event: RunsteadEvent;
}

interface StartupGatePreviousEventRow {
  event_id: string;
  payload_json: string;
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
  const subject = evidenceSubject(artifact);
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
    payload: evidenceEventPayload(evidence, artifact),
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

export async function checkStartupGate(
  options: CheckStartupGateOptions = {}
): Promise<StartupGateCheckResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const domain = options.domain ?? STARTUP_DOMAIN;
  const stage = options.stage ?? "launch";
  const checkedAt = (options.now ?? new Date()).toISOString();
  const resolvedState = await requireRunsteadStateDb(cwd);
  const database = openRunsteadDatabase(resolvedState.stateDb);

  try {
    const tasks = readStartupGateTasks(database, domain);
    const evidence = readStartupGateEvidence(database, domain);
    const artifacts = readStartupGateEvidenceArtifacts(evidence);
    const previousEvent = readPreviousStartupGateEvent(database, domain, stage);
    const gate = evaluateStartupGate({
      stage,
      tasks,
      evidence,
      artifacts,
      checkedAt,
      ...(previousEvent === undefined ? {} : { previousEvent })
    });
    const event: RunsteadEvent = {
      eventId: createRunsteadId("evt"),
      type: "startup_gate.checked",
      aggregateType: "startup_gate",
      aggregateId: `${domain}_${stage}`,
      payload: {
        domain,
        stage,
        passed: gate.passed,
        blockers: gate.blockers,
        warnings: gate.warnings,
        findings: gate.findings,
        waivedBlockers: gate.waivedBlockers,
        diff: gate.diff
      },
      createdAt: checkedAt
    };

    if (options.recordEvent !== false) {
      appendEventAndProject(database, { event });
    }

    return {
      root: resolvedState.root,
      stateDb: resolvedState.stateDb,
      domain,
      stage,
      passed: gate.passed,
      blockers: gate.blockers,
      warnings: gate.warnings,
      findings: gate.findings,
      waivedBlockers: gate.waivedBlockers,
      diff: gate.diff,
      event
    };
  } finally {
    database.close();
  }
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

function readStartupGateTasks(
  database: ReturnType<typeof openRunsteadDatabase>,
  domain: string
): StartupGateTaskRow[] {
  return database
    .prepare(
      `
      SELECT id, type, status
      FROM tasks
      WHERE domain = ?
      ORDER BY updated_at DESC, id ASC
    `
    )
    .all(domain) as unknown as StartupGateTaskRow[];
}

function readStartupGateEvidence(
  database: ReturnType<typeof openRunsteadDatabase>,
  domain: string
): StartupGateEvidenceRow[] {
  return database
    .prepare(
      `
      SELECT DISTINCT e.id, e.type, e.subject_type, e.subject_id, e.uri,
             e.summary, e.created_at
      FROM evidence e
      LEFT JOIN tasks t ON e.subject_type = 'task' AND e.subject_id = t.id
      WHERE t.domain = ?
         OR e.type = 'command_output'
         OR e.type LIKE 'startup_%'
      ORDER BY e.created_at DESC, e.id ASC
    `
    )
    .all(domain) as unknown as StartupGateEvidenceRow[];
}

function readPreviousStartupGateEvent(
  database: ReturnType<typeof openRunsteadDatabase>,
  domain: string,
  stage: StartupGateStage
): StartupGatePreviousEvent | undefined {
  const row = database
    .prepare(
      `
      SELECT event_id, payload_json
      FROM events
      WHERE type = 'startup_gate.checked'
        AND aggregate_type = 'startup_gate'
        AND aggregate_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `
    )
    .get(`${domain}_${stage}`) as StartupGatePreviousEventRow | undefined;

  if (row === undefined) {
    return undefined;
  }

  try {
    const payload = JSON.parse(row.payload_json) as unknown;

    return {
      eventId: row.event_id,
      blockers:
        isRecord(payload) && Array.isArray(payload.blockers)
          ? payload.blockers.filter(hasNonEmptyString)
          : []
    };
  } catch {
    return {
      eventId: row.event_id,
      blockers: []
    };
  }
}

function evidenceSubject(artifact: StartupEvidenceArtifact): {
  subjectType: string;
  subjectId: string;
} {
  if (artifact.associations.goalId !== undefined) {
    return {
      subjectType: "goal",
      subjectId: artifact.associations.goalId
    };
  }

  if (artifact.associations.hypothesisId !== undefined) {
    return {
      subjectType: "hypothesis",
      subjectId: artifact.associations.hypothesisId
    };
  }

  if (artifact.associations.decisionId !== undefined) {
    return {
      subjectType: "decision",
      subjectId: artifact.associations.decisionId
    };
  }

  return {
    subjectType: "startup",
    subjectId: STARTUP_DOMAIN
  };
}

function evidenceEventPayload(
  evidence: Evidence,
  artifact: StartupEvidenceArtifact
): JsonObject {
  return {
    evidenceId: evidence.id,
    evidenceType: evidence.type,
    subjectType: evidence.subjectType,
    subjectId: evidence.subjectId,
    uri: evidence.uri,
    hash: evidence.hash,
    summary: evidence.summary,
    startupEvidenceType: artifact.evidenceType,
    sourceRefs: artifact.sourceRefs,
    sources: artifact.sources,
    provenance: artifact.provenance,
    associations: artifact.associations
  };
}

function startupEvidenceRemediation(
  options: Pick<
    AddStartupEvidenceOptions,
    "owner" | "remediationTask" | "acceptanceCriteria"
  >
): StartupEvidenceArtifact["remediation"] | undefined {
  const values = [options.owner, options.remediationTask, options.acceptanceCriteria];

  if (values.every((value) => value === undefined)) {
    return undefined;
  }

  if (
    options.owner === undefined ||
    options.remediationTask === undefined ||
    options.acceptanceCriteria === undefined
  ) {
    throw new Error(
      "startup evidence remediation requires --owner, --remediation-task, and --acceptance-criteria"
    );
  }

  return {
    owner: options.owner,
    task: options.remediationTask,
    acceptanceCriteria: options.acceptanceCriteria
  };
}
