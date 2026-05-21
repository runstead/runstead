import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createRunsteadId,
  type Evidence,
  type JsonObject,
  type RunsteadEvent
} from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDb } from "./runstead-root.js";

export const STARTUP_EVIDENCE_TYPES = [
  "customer_interview",
  "competitor",
  "metric",
  "metric_snapshot",
  "measurement_framework",
  "agent_context",
  "repo_readiness",
  "security_baseline",
  "migration_plan",
  "rollback_plan",
  "release_plan",
  "hypothesis",
  "problem_hypothesis",
  "user_hypothesis",
  "solution_hypothesis",
  "disconfirming",
  "support_triage",
  "founder_bottleneck",
  "workflow_registry",
  "delegation_policy",
  "institutional_memory",
  "ops_report",
  "integration_map",
  "ops_sop",
  "gtm_artifact",
  "decision",
  "acceptable_debt",
  "false_positive",
  "observability"
] as const;

export type StartupEvidenceType = (typeof STARTUP_EVIDENCE_TYPES)[number];
export type StartupHypothesisKind = "problem" | "user" | "solution";
export type StartupHypothesisStatus =
  | "open"
  | "validated"
  | "invalidated"
  | "needs-more-evidence";
export type StartupGateStage = "idea" | "mvp" | "launch" | "scale";

export interface AddStartupEvidenceOptions {
  cwd?: string;
  type: string;
  summary: string;
  sourceRefs?: string[];
  content?: string;
  goalId?: string;
  hypothesisId?: string;
  decisionId?: string;
  now?: Date;
}

export interface AddStartupEvidenceResult {
  root: string;
  stateDb: string;
  evidence: Evidence;
  event: RunsteadEvent;
  artifact: StartupEvidenceArtifact;
  artifactPath: string;
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

export interface StartupEvidenceArtifact {
  schemaVersion: 1;
  createdAt: string;
  evidenceType: StartupEvidenceType;
  summary: string;
  sourceRefs: string[];
  associations: {
    goalId?: string;
    hypothesisId?: string;
    decisionId?: string;
  };
  content?: string;
}

export interface CheckStartupGateOptions {
  cwd?: string;
  domain?: string;
  stage?: StartupGateStage;
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
  event: RunsteadEvent;
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

interface StartupGateEvidenceArtifact {
  sourceRefs?: unknown;
  associations?: unknown;
  content?: unknown;
  result?: unknown;
}

const STARTUP_DOMAIN = "ai-native-startup";

export async function addStartupEvidence(
  options: AddStartupEvidenceOptions
): Promise<AddStartupEvidenceResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedState = await requireRunsteadStateDb(cwd);
  const createdAt = (options.now ?? new Date()).toISOString();
  const evidenceType = parseStartupEvidenceType(options.type);
  const evidenceId = createRunsteadId("ev");
  const artifact: StartupEvidenceArtifact = {
    schemaVersion: 1,
    createdAt,
    evidenceType,
    summary: options.summary,
    sourceRefs: options.sourceRefs ?? [],
    associations: {
      ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
      ...(options.hypothesisId === undefined
        ? {}
        : { hypothesisId: options.hypothesisId }),
      ...(options.decisionId === undefined ? {} : { decisionId: options.decisionId })
    },
    ...(options.content === undefined ? {} : { content: options.content })
  };
  const artifactContents = `${JSON.stringify(artifact, null, 2)}\n`;
  const evidenceDir = join(resolvedState.root, "evidence");
  const artifactPath = join(evidenceDir, `startup-${evidenceType}-${evidenceId}.json`);
  const subject = evidenceSubject(artifact);
  const evidence: Evidence = {
    id: evidenceId,
    type: `startup_${evidenceType}`,
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    uri: pathToFileURL(artifactPath).href,
    hash: sha256(artifactContents),
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
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(artifactPath, artifactContents, "utf8");
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
    artifactPath
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
    const blockers = gateBlockers({ stage, tasks, evidence, artifacts });
    const warnings = gateWarnings({ stage, tasks, evidence, artifacts });
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
        warnings
      },
      createdAt: checkedAt
    };

    appendEventAndProject(database, { event });

    return {
      root: resolvedState.root,
      stateDb: resolvedState.stateDb,
      domain,
      stage,
      passed: blockers.length === 0,
      blockers,
      warnings,
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
    "",
    "Blockers:",
    listOrNone(result.blockers, (blocker) => `- ${blocker}`),
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
}): string[] {
  if (input.stage === "mvp") {
    return validationBlockers(input.evidence, input.artifacts);
  }

  if (input.stage === "scale") {
    return scaleBlockers(input.evidence);
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
}): string[] {
  if (input.stage === "mvp") {
    return [
      ...(hasEvidenceType(input.evidence, "startup_competitor")
        ? []
        : ["competitor evidence is not recorded"]),
      ...(hasEvidenceType(input.evidence, "startup_metric") ||
      hasEvidenceType(input.evidence, "startup_metric_snapshot")
        ? []
        : ["metric evidence is not recorded"])
    ];
  }

  if (input.stage !== "launch") {
    return [];
  }

  return [
    ...(hasCompletedTask(input.tasks, "run_mvp_verifiers")
      ? []
      : ["run_mvp_verifiers has not completed"]),
    ...(hasPassingCommandOutput(input.evidence, input.artifacts) ||
    hasStructuredMetricEvidence(input.evidence, input.artifacts)
      ? []
      : ["no verifier or metric evidence is recorded"])
  ];
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
    ...acceptedDebtDecisionBlockers(input.evidence, input.artifacts)
  ];
}

function scaleBlockers(evidence: StartupGateEvidenceRow[]): string[] {
  return [
    ...(hasEvidenceType(evidence, "startup_founder_bottleneck")
      ? []
      : ["founder bottleneck map is missing"]),
    ...(hasEvidenceType(evidence, "startup_workflow_registry")
      ? []
      : ["workflow registry is missing"]),
    ...(hasEvidenceType(evidence, "startup_delegation_policy")
      ? []
      : ["delegation policy is missing"]),
    ...(hasEvidenceType(evidence, "startup_institutional_memory")
      ? []
      : ["institutional memory evidence is missing"]),
    ...(hasEvidenceType(evidence, "startup_ops_report")
      ? []
      : ["recurring ops report is missing"]),
    ...(hasEvidenceType(evidence, "startup_integration_map")
      ? []
      : ["integration depth map is missing"]),
    ...(hasEvidenceType(evidence, "startup_ops_sop")
      ? []
      : ["ops SOP evidence is missing"]),
    ...(hasEvidenceType(evidence, "startup_support_triage")
      ? []
      : ["support triage evidence is missing"]),
    ...(hasEvidenceType(evidence, "startup_gtm_artifact")
      ? []
      : ["GTM artifact verification is missing"])
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

function readStartupGateEvidenceArtifacts(
  evidence: StartupGateEvidenceRow[]
): Map<string, StartupGateEvidenceArtifact> {
  const artifacts = new Map<string, StartupGateEvidenceArtifact>();

  for (const item of evidence) {
    const artifact = readStartupGateEvidenceArtifact(item.uri);

    if (artifact !== undefined) {
      artifacts.set(item.id, artifact);
    }
  }

  return artifacts;
}

function readStartupGateEvidenceArtifact(
  uri: string
): StartupGateEvidenceArtifact | undefined {
  try {
    const parsed = JSON.parse(readFileSync(fileURLToPath(uri), "utf8")) as unknown;

    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
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
  return evidence
    .filter((item) =>
      [
        "startup_migration_plan",
        "startup_rollback_plan",
        "startup_observability"
      ].includes(item.type)
    )
    .filter((item) => !hasRemediationQuality(artifacts.get(item.id)))
    .map(
      (item) =>
        `${startupEvidenceLabel(item.type)} needs owner, remediation task, and acceptance criteria`
    );
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

function hasRemediationQuality(
  artifact: StartupGateEvidenceArtifact | undefined
): boolean {
  const content = parsedArtifactContent(artifact);

  return (
    isRecord(content) &&
    hasNonEmptyString(content.owner) &&
    hasNonEmptyString(content.remediationTask) &&
    hasNonEmptyString(content.acceptanceCriteria)
  );
}

function parsedArtifactContent(
  artifact: StartupGateEvidenceArtifact | undefined
): unknown {
  if (artifact === undefined || typeof artifact.content !== "string") {
    return undefined;
  }

  try {
    return JSON.parse(artifact.content) as unknown;
  } catch {
    return undefined;
  }
}

function hasSourceRefs(artifact: StartupGateEvidenceArtifact | undefined): boolean {
  return (
    artifact !== undefined &&
    Array.isArray(artifact.sourceRefs) &&
    artifact.sourceRefs.some((sourceRef) => hasNonEmptyString(sourceRef))
  );
}

function hasHypothesisAssociation(
  artifact: StartupGateEvidenceArtifact | undefined
): boolean {
  return (
    isRecord(artifact?.associations) &&
    hasNonEmptyString(artifact.associations.hypothesisId)
  );
}

function hasDecisionAssociation(
  artifact: StartupGateEvidenceArtifact | undefined
): boolean {
  return (
    isRecord(artifact?.associations) &&
    hasNonEmptyString(artifact.associations.decisionId)
  );
}

function hasNonEmptyValue(value: unknown): boolean {
  return (
    hasNonEmptyString(value) ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function parseStartupEvidenceType(value: string): StartupEvidenceType {
  if (STARTUP_EVIDENCE_TYPES.includes(value as StartupEvidenceType)) {
    return value as StartupEvidenceType;
  }

  throw new Error(
    `Unsupported startup evidence type ${value}. Expected one of: ${STARTUP_EVIDENCE_TYPES.join(", ")}`
  );
}

export function parseStartupHypothesisStatusValue(
  value: unknown
): StartupHypothesisStatus {
  if (
    value === "open" ||
    value === "validated" ||
    value === "invalidated" ||
    value === "needs-more-evidence"
  ) {
    return value;
  }

  return "open";
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
    associations: artifact.associations
  };
}

function listOrNone<T>(items: T[], formatter: (item: T) => string): string {
  if (items.length === 0) {
    return "- none";
  }

  return items.map(formatter).join("\n");
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}
