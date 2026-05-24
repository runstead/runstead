import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  checkStartupGate,
  type StartupGateCheckResult,
  type StartupGateStage
} from "./startup-evidence.js";
import { readLatestStartupReadinessSnapshot } from "./startup-readiness-snapshot.js";
import { startupVerdictReady } from "./startup-verdict.js";

export interface StartupStatusOptions {
  cwd?: string;
  domain?: string;
  now?: Date;
}

export interface StartupStatusResult {
  root: string;
  stateDb: string;
  domain: string;
  generatedAt: string;
  currentStage: StartupGateStage;
  gates: StartupStatusGate[];
  readiness?: StartupStatusReadinessVerdict;
  evidence: StartupStatusEvidenceSummary;
  nextAction: StartupStatusNextAction;
}

export interface StartupStatusReadinessVerdict {
  runId: string;
  target: string;
  verdict: string;
  blockers: string[];
  completedAt?: string;
}

export interface StartupStatusGate {
  stage: StartupGateStage;
  status: "passed" | "blocked";
  blockers: string[];
  warnings: string[];
}

export interface StartupStatusEvidenceSummary {
  total: number;
  latest?: StartupStatusEvidenceItem;
  staleSources: StartupStatusStaleSource[];
  sourceKinds: string[];
}

export interface StartupStatusEvidenceItem {
  id: string;
  type: string;
  summary?: string;
  createdAt: string;
}

export interface StartupStatusStaleSource {
  evidenceId: string;
  type: string;
  uri: string;
  capturedAt: string;
  freshnessDays: number;
  ageDays: number;
}

export interface StartupStatusNextAction {
  command: string;
  reason: string;
}

interface EvidenceRow {
  id: string;
  type: string;
  uri: string;
  summary: string | null;
  created_at: string;
}

interface StartupEvidenceArtifact {
  sources?: unknown;
}

interface StartupEvidenceSource {
  kind?: unknown;
  uri?: unknown;
  capturedAt?: unknown;
  freshnessDays?: unknown;
}

const STARTUP_DOMAIN = "ai-native-startup";
const STARTUP_STAGES: StartupGateStage[] = ["mvp", "launch", "scale"];

export async function getStartupStatus(
  options: StartupStatusOptions = {}
): Promise<StartupStatusResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const domain = options.domain ?? STARTUP_DOMAIN;
  const generatedAt = (options.now ?? new Date()).toISOString();
  const resolvedState = await requireRunsteadStateDb(cwd);
  const gateResults: StartupGateCheckResult[] = [];

  for (const stage of STARTUP_STAGES) {
    gateResults.push(
      await checkStartupGate({
        cwd,
        domain,
        stage,
        now: new Date(generatedAt),
        recordEvent: false
      })
    );
  }

  const evidence = readStartupStatusEvidence({
    stateDb: resolvedState.stateDb,
    generatedAt
  });
  const readiness = readLatestStartupReadinessSnapshot({
    root: resolvedState.root,
    stateDb: resolvedState.stateDb
  });
  const gates: StartupStatusGate[] = gateResults.map((gate) => ({
    stage: gate.stage,
    status: gate.passed ? "passed" : "blocked",
    blockers: gate.blockers,
    warnings: gate.warnings
  }));

  return {
    root: resolvedState.root,
    stateDb: resolvedState.stateDb,
    domain,
    generatedAt,
    currentStage: currentStartupStage(gates, readiness),
    gates,
    ...(readiness === undefined ? {} : { readiness }),
    evidence,
    nextAction: nextStartupAction(gates, evidence, readiness)
  };
}

export function formatStartupStatus(result: StartupStatusResult): string {
  return [
    "Startup status",
    `Root: ${result.root}`,
    `Domain: ${result.domain}`,
    `Current stage: ${result.currentStage}`,
    ...(result.readiness === undefined
      ? []
      : [`Readiness verdict: ${result.readiness.verdict} (${result.readiness.runId})`]),
    `Evidence: ${result.evidence.total} record${result.evidence.total === 1 ? "" : "s"}`,
    ...(result.evidence.latest === undefined
      ? []
      : [
          `Latest evidence: ${result.evidence.latest.id} ${result.evidence.latest.type}`
        ]),
    `Stale sources: ${result.evidence.staleSources.length}`,
    "",
    "Gates:",
    ...result.gates.map(
      (gate) =>
        `- ${gate.stage}: ${gate.status} (${gate.blockers.length} blocker${gate.blockers.length === 1 ? "" : "s"})`
    ),
    "",
    "Next action:",
    `- ${result.nextAction.command}`,
    `  ${result.nextAction.reason}`,
    "",
    "Top blockers:",
    listOrNone(topBlockers(result.gates, result.readiness), (blocker) => `- ${blocker}`)
  ].join("\n");
}

function readStartupStatusEvidence(input: {
  stateDb: string;
  generatedAt: string;
}): StartupStatusEvidenceSummary {
  const database = openRunsteadDatabase(input.stateDb);

  try {
    const rows = database
      .prepare(
        `
        SELECT id, type, uri, summary, created_at
        FROM evidence
        WHERE type = 'command_output' OR type LIKE 'startup_%'
        ORDER BY created_at DESC, id DESC
      `
      )
      .all() as unknown as EvidenceRow[];
    const sourceKinds = new Set<string>();
    const staleSources: StartupStatusStaleSource[] = [];

    for (const row of rows) {
      const artifact = readEvidenceArtifact(row.uri);

      for (const source of artifactSources(artifact)) {
        if (typeof source.kind === "string" && source.kind.trim().length > 0) {
          sourceKinds.add(source.kind);
        }

        const stale = staleSource(row, source, input.generatedAt);

        if (stale !== undefined) {
          staleSources.push(stale);
        }
      }
    }

    const latest = rows[0];

    return {
      total: rows.length,
      ...(latest === undefined
        ? {}
        : {
            latest: {
              id: latest.id,
              type: latest.type,
              ...(latest.summary === null ? {} : { summary: latest.summary }),
              createdAt: latest.created_at
            }
          }),
      staleSources,
      sourceKinds: [...sourceKinds].sort()
    };
  } finally {
    database.close();
  }
}

function readEvidenceArtifact(uri: string): StartupEvidenceArtifact | undefined {
  try {
    const parsed = JSON.parse(readFileSync(fileURLToPath(uri), "utf8")) as unknown;

    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function artifactSources(
  artifact: StartupEvidenceArtifact | undefined
): StartupEvidenceSource[] {
  return Array.isArray(artifact?.sources) ? artifact.sources.filter(isRecord) : [];
}

function staleSource(
  row: EvidenceRow,
  source: StartupEvidenceSource,
  generatedAt: string
): StartupStatusStaleSource | undefined {
  if (
    typeof source.uri !== "string" ||
    typeof source.capturedAt !== "string" ||
    typeof source.freshnessDays !== "number"
  ) {
    return undefined;
  }

  const capturedAt = Date.parse(source.capturedAt);
  const checkedAt = Date.parse(generatedAt);

  if (Number.isNaN(capturedAt) || Number.isNaN(checkedAt)) {
    return undefined;
  }

  const ageDays = Math.floor((checkedAt - capturedAt) / 86_400_000);

  return ageDays > source.freshnessDays
    ? {
        evidenceId: row.id,
        type: row.type,
        uri: source.uri,
        capturedAt: source.capturedAt,
        freshnessDays: source.freshnessDays,
        ageDays
      }
    : undefined;
}

function currentStartupStage(
  gates: StartupStatusGate[],
  readiness: StartupStatusReadinessVerdict | undefined
): StartupGateStage {
  if (readinessVerdictReady(readiness)) {
    return readiness?.target === "local" ? "launch" : "scale";
  }

  const mvpGate = gates.find((gate) => gate.stage === "mvp");
  const launchGate = gates.find((gate) => gate.stage === "launch");
  const scaleGate = gates.find((gate) => gate.stage === "scale");

  if (mvpGate?.status === "blocked") {
    return "mvp";
  }

  if (scaleGate?.status === "passed") {
    return "scale";
  }

  if (launchGate?.status === "passed") {
    return "scale";
  }

  return launchGate?.status === "blocked" ? "launch" : "mvp";
}

function nextStartupAction(
  gates: StartupStatusGate[],
  evidence: StartupStatusEvidenceSummary,
  readiness: StartupStatusReadinessVerdict | undefined
): StartupStatusNextAction {
  if (readinessVerdictReady(readiness)) {
    return {
      command: "runstead startup ready --stage launch",
      reason: `Latest startup readiness run ${readiness.runId} reported ${readiness.verdict}.`
    };
  }

  const mvpGate = gates.find((gate) => gate.stage === "mvp");
  const launchGate = gates.find((gate) => gate.stage === "launch");
  const scaleGate = gates.find((gate) => gate.stage === "scale");

  if (evidence.total === 0) {
    return {
      command: "runstead startup onboard",
      reason: "No startup evidence is recorded yet."
    };
  }

  if (mvpGate?.status === "blocked") {
    return {
      command: "runstead startup gate check --stage mvp",
      reason: "MVP validation evidence is still blocking the build gate."
    };
  }

  if (launchGate?.status === "blocked") {
    return {
      command: "runstead startup remediate --stage launch --execute --worker codex_cli",
      reason: "Launch readiness has unresolved blockers."
    };
  }

  if (scaleGate?.status === "blocked") {
    return {
      command: "runstead startup scale-check",
      reason: "Launch is ready; scale handoff evidence is still incomplete."
    };
  }

  return {
    command: "runstead startup launch-check",
    reason: "All current startup gates pass; rerun launch readiness before release."
  };
}

function topBlockers(
  gates: StartupStatusGate[],
  readiness: StartupStatusReadinessVerdict | undefined
): string[] {
  if (readinessVerdictReady(readiness)) {
    return [];
  }

  return gates.flatMap((gate) =>
    gate.blockers.slice(0, 3).map((blocker) => `${gate.stage}: ${blocker}`)
  );
}

function readinessVerdictReady(
  readiness: StartupStatusReadinessVerdict | undefined
): readiness is StartupStatusReadinessVerdict {
  return readiness !== undefined && startupVerdictReady(readiness.verdict);
}

function listOrNone<T>(items: T[], formatter: (item: T) => string): string {
  return items.length === 0 ? "- none" : items.map(formatter).join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
