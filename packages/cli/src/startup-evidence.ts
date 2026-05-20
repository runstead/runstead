import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
  "observability"
] as const;

export type StartupEvidenceType = (typeof STARTUP_EVIDENCE_TYPES)[number];
export type StartupHypothesisKind = "problem" | "user" | "solution";
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
  summary: string | null;
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
        statement: options.statement
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
    const blockers = gateBlockers({ stage, tasks, evidence });
    const warnings = gateWarnings({ stage, tasks, evidence });
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
      SELECT DISTINCT e.id, e.type, e.subject_type, e.subject_id, e.summary
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
}): string[] {
  if (input.stage === "mvp") {
    return validationBlockers(input.evidence);
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
}): string[] {
  if (input.stage === "mvp") {
    return [
      ...(hasEvidenceType(input.evidence, "startup_competitor")
        ? []
        : ["competitor evidence is not recorded"]),
      ...(hasEvidenceType(input.evidence, "startup_metric")
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
    ...(hasEvidenceType(input.evidence, "command_output") ||
    hasEvidenceType(input.evidence, "startup_metric")
      ? []
      : ["no verifier or metric evidence is recorded"])
  ];
}

function validationBlockers(evidence: StartupGateEvidenceRow[]): string[] {
  return [
    ...(hasEvidenceType(evidence, "startup_problem_hypothesis")
      ? []
      : ["problem hypothesis is missing"]),
    ...(hasEvidenceType(evidence, "startup_user_hypothesis")
      ? []
      : ["user hypothesis is missing"]),
    ...(hasEvidenceType(evidence, "startup_solution_hypothesis")
      ? []
      : ["solution hypothesis is missing"]),
    ...(hasValidationEvidence(evidence)
      ? []
      : ["customer, competitor, or metric validation evidence is missing"]),
    ...(hasEvidenceType(evidence, "startup_disconfirming")
      ? []
      : ["disconfirming evidence is missing"])
  ];
}

function hasValidationEvidence(evidence: StartupGateEvidenceRow[]): boolean {
  return ["startup_customer_interview", "startup_competitor", "startup_metric"].some(
    (type) => hasEvidenceType(evidence, type)
  );
}

function launchBlockers(input: {
  tasks: StartupGateTaskRow[];
  evidence: StartupGateEvidenceRow[];
}): string[] {
  return [
    ...(hasMeasurementFramework(input) ? [] : ["measurement framework is missing"]),
    ...(hasEvidenceType(input.evidence, "startup_repo_readiness") ||
    hasCompletedTask(input.tasks, "inspect_repo_readiness")
      ? []
      : ["repo readiness audit is missing"]),
    ...(hasEvidenceType(input.evidence, "startup_security_baseline")
      ? []
      : ["security baseline is missing"]),
    ...(hasEvidenceType(input.evidence, "command_output") ||
    hasCompletedTask(input.tasks, "run_mvp_verifiers")
      ? []
      : ["verifier evidence is missing"]),
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
      : ["founder bottleneck audit is missing"])
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
