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
  parseStartupHypothesisStatusValue,
  validateStartupEvidenceContent,
  type StartupEvidenceType,
  type StartupGateStage,
  type StartupHypothesisKind,
  type StartupHypothesisStatus
} from "./startup-evidence-types.js";
import {
  arrayHasString,
  artifactSources,
  hasDecisionAssociation,
  hasHypothesisAssociation,
  hasNonEmptyString,
  hasNonEmptyValue,
  hasSourceRefs,
  isRecord,
  parsedArtifactContent,
  type StartupGateEvidenceArtifact
} from "./startup-gate-artifacts.js";
import {
  normalizeStartupEvidenceSources,
  startupEvidenceProvenance,
  type StartupEvidenceSource,
  type StartupEvidenceSourceInput
} from "./startup-evidence-sources.js";
import {
  explainGateBlocker,
  inferGateFindingSeverity,
  remediationTaskForBlocker,
  stableGateFindingId,
  startupGateRuleForBlocker,
  type StartupGateFindingSeverity
} from "./startup-gate-rules.js";

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

export interface StartupGateFinding {
  id: string;
  severity: StartupGateFindingSeverity;
  message: string;
  explanation: string;
  remediationTask: string;
  waived: boolean;
  waiverEvidenceId?: string;
}

export interface StartupGateWaiver {
  evidenceId: string;
  blocker: string;
  owner: string;
  reason: string;
  expiresAt: string;
}

export interface StartupGateDiff {
  previousEventId?: string;
  addedBlockers: string[];
  resolvedBlockers: string[];
}

interface StartupGateTaskRow {
  id: string;
  type: string;
  status: string;
}

interface StartupGateEvidenceRow {
  id: string;
  type: string;
  subject_type: string;
  subject_id: string;
  uri: string;
  summary: string | null;
  created_at: string;
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
    const rawBlockers = gateBlockers({ stage, tasks, evidence, artifacts, checkedAt });
    const activeWaivers = activeStartupGateWaivers({
      stage,
      evidence,
      artifacts,
      checkedAt
    });
    const findings = startupGateFindings(stage, rawBlockers, activeWaivers);
    const blockers = findings
      .filter((finding) => !finding.waived && finding.severity !== "warning")
      .map((finding) => finding.message);
    const warnings = [
      ...gateWarnings({ stage, tasks, evidence, artifacts, checkedAt }),
      ...findings
        .filter((finding) => finding.waived)
        .map((finding) => `waived blocker: ${finding.message}`)
    ];
    const previousEvent = readPreviousStartupGateEvent(database, domain, stage);
    const diff = startupGateDiff(previousEvent, blockers);
    const event: RunsteadEvent = {
      eventId: createRunsteadId("evt"),
      type: "startup_gate.checked",
      aggregateType: "startup_gate",
      aggregateId: `${domain}_${stage}`,
      payload: {
        domain,
        stage,
        passed: blockers.length === 0,
        blockers,
        warnings,
        findings,
        waivedBlockers: activeWaivers,
        diff
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
      passed: blockers.length === 0,
      blockers,
      warnings,
      findings,
      waivedBlockers: activeWaivers,
      diff,
      event
    };
  } finally {
    database.close();
  }
}

export function formatStartupGateCheckResult(result: StartupGateCheckResult): string {
  return [
    `Startup gate: ${result.stage}`,
    `Domain: ${result.domain}`,
    `Status: ${result.passed ? "passed" : "blocked"}`,
    `Added blockers: ${result.diff.addedBlockers.length}`,
    `Resolved blockers: ${result.diff.resolvedBlockers.length}`,
    "",
    "Blockers:",
    listOrNone(result.blockers, (blocker) => `- ${blocker}`),
    "",
    "Findings:",
    listOrNone(
      result.findings,
      (finding) =>
        `- [${finding.severity}] ${finding.message}${finding.waived ? " (waived)" : ""}`
    ),
    ...(result.stage === "mvp" && !result.passed
      ? [
          "",
          "MVP build gate explanation:",
          "MVP build cannot start until each blocker has evidence, hypothesis status, and disconfirming-signal resolution."
        ]
      : []),
    "",
    "Warnings:",
    listOrNone(result.warnings, (warning) => `- ${warning}`)
  ].join("\n");
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

function gateBlockers(input: {
  stage: StartupGateStage;
  tasks: StartupGateTaskRow[];
  evidence: StartupGateEvidenceRow[];
  artifacts: Map<string, StartupGateEvidenceArtifact>;
  checkedAt: string;
}): string[] {
  if (input.stage === "mvp") {
    return validationBlockers(input.evidence, input.artifacts);
  }

  if (input.stage === "scale") {
    return scaleBlockers(input.evidence, input.artifacts, input.checkedAt);
  }

  if (input.stage !== "launch") {
    return [];
  }

  return launchBlockers(input);
}

function gateWarnings(input: {
  stage: StartupGateStage;
  tasks: StartupGateTaskRow[];
  evidence: StartupGateEvidenceRow[];
  artifacts: Map<string, StartupGateEvidenceArtifact>;
  checkedAt: string;
}): string[] {
  if (input.stage === "mvp") {
    return [
      ...(hasEvidenceType(input.evidence, "startup_competitor")
        ? []
        : ["competitor evidence is not recorded"]),
      ...(hasEvidenceType(input.evidence, "startup_metric") ||
      hasEvidenceType(input.evidence, "startup_metric_snapshot")
        ? []
        : ["metric evidence is not recorded"]),
      ...staleEvidenceSourceWarnings(input.evidence, input.artifacts, input.checkedAt)
    ];
  }

  if (input.stage !== "launch") {
    return staleEvidenceSourceWarnings(
      input.evidence,
      input.artifacts,
      input.checkedAt
    );
  }

  const hasVerifierEvidence = hasPassingCommandOutput(input.evidence, input.artifacts);

  return [
    ...(hasCompletedTask(input.tasks, "run_mvp_verifiers") || hasVerifierEvidence
      ? []
      : ["run_mvp_verifiers has not completed"]),
    ...(hasVerifierEvidence ||
    hasStructuredMetricEvidence(input.evidence, input.artifacts)
      ? []
      : ["no verifier or metric evidence is recorded"]),
    ...staleEvidenceSourceWarnings(input.evidence, input.artifacts, input.checkedAt)
  ];
}

function activeStartupGateWaivers(input: {
  stage: StartupGateStage;
  evidence: StartupGateEvidenceRow[];
  artifacts: Map<string, StartupGateEvidenceArtifact>;
  checkedAt: string;
}): StartupGateWaiver[] {
  return input.evidence
    .filter((item) => item.type === "startup_decision")
    .flatMap((item) => {
      const content = parsedArtifactContent(input.artifacts.get(item.id));

      if (
        !isRecord(content) ||
        content.kind !== "gate_waiver" ||
        content.gate !== input.stage ||
        !hasNonEmptyString(content.blocker) ||
        !hasNonEmptyString(content.owner) ||
        !hasNonEmptyString(content.reason) ||
        !hasNonEmptyString(content.expiresAt)
      ) {
        return [];
      }

      if (Date.parse(content.expiresAt) <= Date.parse(input.checkedAt)) {
        return [];
      }

      return [
        {
          evidenceId: item.id,
          blocker: content.blocker,
          owner: content.owner,
          reason: content.reason,
          expiresAt: content.expiresAt
        }
      ];
    });
}

function startupGateFindings(
  stage: StartupGateStage,
  blockers: string[],
  waivers: StartupGateWaiver[]
): StartupGateFinding[] {
  return blockers.map((blocker) => {
    const waiver = waivers.find((item) => item.blocker === blocker);
    const rule = startupGateRuleForBlocker(stage, blocker);

    return {
      id: rule?.id ?? stableGateFindingId(stage, blocker),
      severity: rule?.severity ?? inferGateFindingSeverity(blocker),
      message: blocker,
      explanation: rule?.explanation ?? explainGateBlocker(blocker),
      remediationTask: rule?.remediationTask ?? remediationTaskForBlocker(blocker),
      waived: waiver !== undefined,
      ...(waiver === undefined ? {} : { waiverEvidenceId: waiver.evidenceId })
    };
  });
}

function startupGateDiff(
  previous: { eventId: string; blockers: string[] } | undefined,
  blockers: string[]
): StartupGateDiff {
  const previousBlockers = new Set(previous?.blockers ?? []);
  const currentBlockers = new Set(blockers);

  return {
    ...(previous === undefined ? {} : { previousEventId: previous.eventId }),
    addedBlockers: blockers.filter((blocker) => !previousBlockers.has(blocker)),
    resolvedBlockers: [...previousBlockers].filter(
      (blocker) => !currentBlockers.has(blocker)
    )
  };
}

function readPreviousStartupGateEvent(
  database: ReturnType<typeof openRunsteadDatabase>,
  domain: string,
  stage: StartupGateStage
): { eventId: string; blockers: string[] } | undefined {
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

function staleEvidenceSourceWarnings(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>,
  checkedAt: string
): string[] {
  return evidence.flatMap((row) => {
    const sources = artifactSources(artifacts.get(row.id));

    return sources.flatMap((source) => {
      if (
        !hasNonEmptyString(source.uri) ||
        !hasNonEmptyString(source.capturedAt) ||
        typeof source.freshnessDays !== "number"
      ) {
        return [];
      }

      const capturedAt = Date.parse(source.capturedAt);
      const ageDays = Math.floor((Date.parse(checkedAt) - capturedAt) / 86_400_000);

      return Number.isNaN(capturedAt) || ageDays <= source.freshnessDays
        ? []
        : [
            `stale evidence source for ${row.type}: ${source.uri} is ${ageDays}d old (freshness ${source.freshnessDays}d)`
          ];
    });
  });
}

function validationBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  return [
    ...hypothesisGateBlockers("problem", evidence, artifacts),
    ...hypothesisGateBlockers("user", evidence, artifacts),
    ...hypothesisGateBlockers("solution", evidence, artifacts),
    ...(hasValidationEvidence(evidence, artifacts)
      ? []
      : ["customer, competitor, or metric validation evidence is missing"]),
    ...(hasEvidenceType(evidence, "startup_disconfirming")
      ? []
      : ["disconfirming evidence is missing"]),
    ...disconfirmingEvidenceBlockers(evidence, artifacts)
  ];
}

function hypothesisGateBlockers(
  kind: StartupHypothesisKind,
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  const rows = evidence.filter((item) => item.type === `startup_${kind}_hypothesis`);

  if (rows.length === 0) {
    return [`${kind} hypothesis is missing`];
  }

  const latestStatus = hypothesisStatus(artifacts.get(rows[0]?.id ?? ""));

  if (latestStatus === "validated") {
    return [];
  }

  if (latestStatus === "invalidated") {
    return [`${kind} hypothesis is invalidated`];
  }

  if (latestStatus === "needs-more-evidence") {
    return [`${kind} hypothesis needs more evidence`];
  }

  return [`${kind} hypothesis is open and not validated`];
}

function hypothesisStatus(
  artifact: StartupGateEvidenceArtifact | undefined
): StartupHypothesisStatus {
  const content = parsedArtifactContent(artifact);

  if (!isRecord(content)) {
    return "open";
  }

  return parseStartupHypothesisStatusValue(content.status);
}

function disconfirmingEvidenceBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  return evidence
    .filter((item) => item.type === "startup_disconfirming")
    .filter((item) => disconfirmingEvidenceBlocksMvp(artifacts.get(item.id)))
    .map((item) => {
      const summary = item.summary ?? "disconfirming evidence";

      return `disconfirming evidence blocks MVP build: ${summary}`;
    });
}

function disconfirmingEvidenceBlocksMvp(
  artifact: StartupGateEvidenceArtifact | undefined
): boolean {
  const content = parsedArtifactContent(artifact);

  if (!isRecord(content)) {
    return false;
  }

  return content.impact === "blocker" || content.impact === "invalidates";
}

function hasValidationEvidence(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): boolean {
  if (hasStructuredMetricEvidence(evidence, artifacts)) {
    return true;
  }

  return ["startup_customer_interview", "startup_competitor", "startup_metric"].some(
    (type) =>
      evidence
        .filter((item) => item.type === type)
        .some((item) => hasStructuredValidationArtifact(item, artifacts.get(item.id)))
  );
}

function launchBlockers(input: {
  tasks: StartupGateTaskRow[];
  evidence: StartupGateEvidenceRow[];
  artifacts: Map<string, StartupGateEvidenceArtifact>;
}): string[] {
  return [
    ...(hasMeasurementFramework(input) ? [] : ["measurement framework is missing"]),
    ...(hasStructuredMetricEvidence(input.evidence, input.artifacts)
      ? []
      : ["metric snapshot with source, threshold, and current value is missing"]),
    ...(hasEvidenceType(input.evidence, "startup_repo_readiness") ||
    hasCompletedTask(input.tasks, "inspect_repo_readiness")
      ? []
      : ["repo readiness audit is missing"]),
    ...(hasEvidenceType(input.evidence, "startup_security_baseline")
      ? []
      : ["security baseline is missing"]),
    ...(hasPassingCommandOutput(input.evidence, input.artifacts)
      ? []
      : ["passing verifier command evidence is missing"]),
    ...(hasEvidenceType(input.evidence, "startup_migration_plan")
      ? []
      : ["migration plan evidence is missing"]),
    ...(hasEvidenceType(input.evidence, "startup_rollback_plan")
      ? []
      : ["rollback plan evidence is missing"]),
    ...(hasEvidenceType(input.evidence, "startup_observability")
      ? []
      : ["observability evidence is missing"]),
    ...(hasEvidenceType(input.evidence, "startup_founder_bottleneck")
      ? []
      : ["founder bottleneck audit is missing"]),
    ...launchEvidenceQualityBlockers(input.evidence, input.artifacts),
    ...uiValidationBlockers(input.evidence, input.artifacts),
    ...acceptedDebtDecisionBlockers(input.evidence, input.artifacts)
  ];
}

function scaleBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>,
  checkedAt: string
): string[] {
  return [
    ...(hasEvidenceType(evidence, "startup_founder_bottleneck")
      ? []
      : ["founder bottleneck map is missing"]),
    ...founderBottleneckAgingBlockers(evidence, artifacts, checkedAt),
    ...(hasEvidenceType(evidence, "startup_workflow_registry")
      ? []
      : ["workflow registry is missing"]),
    ...(hasEvidenceType(evidence, "startup_delegation_policy")
      ? []
      : ["delegation policy is missing"]),
    ...delegationPolicyConstraintBlockers(evidence, artifacts),
    ...(hasEvidenceType(evidence, "startup_institutional_memory")
      ? []
      : ["institutional memory evidence is missing"]),
    ...(hasEvidenceType(evidence, "startup_ops_schedule")
      ? []
      : ["scale report schedule is missing"]),
    ...(hasEvidenceType(evidence, "startup_ops_report")
      ? []
      : ["recurring ops report is missing"]),
    ...(hasEvidenceType(evidence, "startup_integration_map")
      ? []
      : ["integration depth map is missing"]),
    ...integrationDepthSignalBlockers(evidence, artifacts),
    ...(hasEvidenceType(evidence, "startup_ops_sop")
      ? []
      : ["ops SOP evidence is missing"]),
    ...(hasEvidenceType(evidence, "startup_support_triage")
      ? []
      : ["support triage evidence is missing"]),
    ...(hasEvidenceType(evidence, "startup_gtm_artifact")
      ? []
      : ["GTM artifact verification is missing"]),
    ...gtmClaimBindingBlockers(evidence, artifacts)
  ];
}

function hasMeasurementFramework(input: {
  tasks: StartupGateTaskRow[];
  evidence: StartupGateEvidenceRow[];
}): boolean {
  return (
    hasEvidenceType(input.evidence, "startup_measurement_framework") ||
    hasCompletedTask(input.tasks, "define_measurement_framework")
  );
}

function hasCompletedTask(tasks: StartupGateTaskRow[], type: string): boolean {
  return tasks.some((task) => task.type === type && task.status === "completed");
}

function hasEvidenceType(evidence: StartupGateEvidenceRow[], type: string): boolean {
  return evidence.some((item) => item.type === type);
}

function hasPassingCommandOutput(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): boolean {
  return evidence
    .filter((item) => item.type === "command_output")
    .some((item) => {
      const result = artifacts.get(item.id)?.result;

      return (
        isRecord(result) &&
        result.exitCode === 0 &&
        result.timedOut === false &&
        result.forceKilled === false
      );
    });
}

function hasStructuredMetricEvidence(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): boolean {
  return evidence
    .filter(
      (item) =>
        item.type === "startup_metric" || item.type === "startup_metric_snapshot"
    )
    .some((item) => {
      const content = parsedArtifactContent(artifacts.get(item.id));

      return (
        isRecord(content) &&
        hasNonEmptyString(content.source) &&
        hasNonEmptyValue(content.threshold) &&
        hasNonEmptyValue(content.current)
      );
    });
}

function hasStructuredValidationArtifact(
  row: StartupGateEvidenceRow,
  artifact: StartupGateEvidenceArtifact | undefined
): boolean {
  if (row.type === "startup_metric") {
    const content = parsedArtifactContent(artifact);

    return (
      isRecord(content) &&
      hasNonEmptyString(content.source) &&
      hasNonEmptyValue(content.threshold) &&
      hasNonEmptyValue(content.current)
    );
  }

  if (row.type === "startup_customer_interview") {
    const content = parsedArtifactContent(artifact);

    return (
      isRecord(content) &&
      hasSourceRefs(artifact) &&
      hasHypothesisAssociation(artifact) &&
      hasNonEmptyString(content.persona) &&
      hasNonEmptyString(content.problem) &&
      hasNonEmptyString(content.signalStrength) &&
      (hasNonEmptyString(content.quote) || hasNonEmptyString(content.summary))
    );
  }

  if (row.type === "startup_competitor") {
    const content = parsedArtifactContent(artifact);

    return (
      isRecord(content) &&
      hasSourceRefs(artifact) &&
      hasNonEmptyString(content.competitor) &&
      hasNonEmptyString(content.finding) &&
      hasNonEmptyString(content.signalStrength)
    );
  }

  return false;
}

function launchEvidenceQualityBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  return [
    "startup_migration_plan",
    "startup_rollback_plan",
    "startup_observability"
  ].flatMap((type) => {
    const rows = evidence.filter((item) => item.type === type);

    if (rows.length === 0) {
      return [];
    }

    return rows.some((item) => hasRemediationQuality(artifacts.get(item.id)))
      ? []
      : [
          `${startupEvidenceLabel(type)} needs owner, remediation task, and acceptance criteria`
        ];
  });
}

function acceptedDebtDecisionBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  const undecidedDebt = evidence
    .filter((item) => item.type === "startup_acceptable_debt")
    .filter((item) => !hasDecisionAssociation(artifacts.get(item.id)));

  return undecidedDebt.length === 0
    ? []
    : ["accepted debt requires an explicit decision association"];
}

function uiValidationBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  return latestUiValidationsByTarget(evidence, artifacts)
    .filter((item) => uiValidationFailed(artifacts.get(item.id)))
    .map((item) => `frontend UI validation failed: ${item.summary ?? item.id}`);
}

function latestUiValidationsByTarget(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): StartupGateEvidenceRow[] {
  const latestByTarget = new Map<string, StartupGateEvidenceRow>();

  for (const item of evidence.filter((row) => row.type === "startup_ui_validation")) {
    const target = uiValidationTarget(item, artifacts.get(item.id));
    const current = latestByTarget.get(target);

    if (current === undefined || evidenceIsNewer(item, current)) {
      latestByTarget.set(target, item);
    }
  }

  return [...latestByTarget.values()];
}

function uiValidationTarget(
  row: StartupGateEvidenceRow,
  artifact: StartupGateEvidenceArtifact | undefined
): string {
  const content = parsedArtifactContent(artifact);

  if (
    isRecord(content) &&
    hasNonEmptyString(content.url) &&
    hasNonEmptyString(content.viewport)
  ) {
    return `${content.url} ${content.viewport}`;
  }

  return row.summary ?? row.id;
}

function evidenceIsNewer(
  candidate: StartupGateEvidenceRow,
  current: StartupGateEvidenceRow
): boolean {
  const candidateTime = Date.parse(candidate.created_at);
  const currentTime = Date.parse(current.created_at);

  if (Number.isFinite(candidateTime) && Number.isFinite(currentTime)) {
    return candidateTime === currentTime
      ? candidate.id > current.id
      : candidateTime > currentTime;
  }

  return candidate.created_at === current.created_at
    ? candidate.id > current.id
    : candidate.created_at > current.created_at;
}

function uiValidationFailed(
  artifact: StartupGateEvidenceArtifact | undefined
): boolean {
  const content = parsedArtifactContent(artifact);

  return (
    isRecord(content) &&
    [
      content.domStatus,
      content.accessibilityStatus,
      content.responsiveStatus,
      content.criticalFlowStatus
    ].some((status) => status === "fail" || status === "failed")
  );
}

function founderBottleneckAgingBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>,
  checkedAt: string
): string[] {
  return evidence
    .filter((item) => item.type === "startup_founder_bottleneck")
    .filter((item) => {
      const content = parsedArtifactContent(artifacts.get(item.id));

      if (!isRecord(content) || content.status === "handoff-complete") {
        return false;
      }

      return (
        typeof content.handoffDueDate === "string" &&
        Date.parse(content.handoffDueDate) < Date.parse(checkedAt)
      );
    })
    .map(() => "founder bottleneck handoff is overdue");
}

function delegationPolicyConstraintBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  const rows = evidence.filter((item) => item.type === "startup_delegation_policy");

  if (rows.length === 0) {
    return [];
  }

  const content = parsedArtifactContent(artifacts.get(rows[0]?.id ?? ""));

  return isRecord(content) &&
    arrayHasString(content.allowedAgents) &&
    arrayHasString(content.constrainedTaskTypes)
    ? []
    : ["delegation policy must define allowed agents and constrained task types"];
}

function integrationDepthSignalBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  const rows = evidence.filter((item) => item.type === "startup_integration_map");

  if (rows.length === 0) {
    return [];
  }

  const content = parsedArtifactContent(artifacts.get(rows[0]?.id ?? ""));
  const hasAdoptionSignal =
    isRecord(content) &&
    (arrayHasString(content.adoptionSignals) || arrayHasString(content.lockInSignals));
  const hasWorkflowSignal =
    isRecord(content) &&
    (arrayHasString(content.workflowSignals) ||
      arrayHasString(content.automationCoverage));

  return hasAdoptionSignal && hasWorkflowSignal
    ? []
    : ["integration depth map needs adoption and workflow signals"];
}

function gtmClaimBindingBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  const rows = evidence.filter((item) => item.type === "startup_gtm_artifact");

  if (rows.length === 0) {
    return [];
  }

  const content = parsedArtifactContent(artifacts.get(rows[0]?.id ?? ""));

  return isRecord(content) &&
    arrayHasString(content.evidenceRefs) &&
    hasNonEmptyString(content.productState) &&
    content.productState !== "unrecorded"
    ? []
    : ["GTM claim must bind to evidence refs and recorded product state"];
}

function hasRemediationQuality(
  artifact: StartupGateEvidenceArtifact | undefined
): boolean {
  const content = parsedArtifactContent(artifact);
  const remediation = artifact?.remediation;

  return (
    hasRemediationQualityFields(content) || hasRemediationQualityFields(remediation)
  );
}

function hasRemediationQualityFields(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasNonEmptyString(value.owner) &&
    hasNonEmptyString(
      value.remediationTask === undefined ? value.task : value.remediationTask
    ) &&
    hasNonEmptyString(value.acceptanceCriteria)
  );
}

function startupEvidenceLabel(type: string): string {
  return type.replace(/^startup_/, "").replaceAll("_", " ");
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

function listOrNone<T>(items: T[], formatter: (item: T) => string): string {
  if (items.length === 0) {
    return "- none";
  }

  return items.map(formatter).join("\n");
}
