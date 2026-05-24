import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

export interface StartupReadinessVerdictSnapshot {
  runId: string;
  stage?: string;
  target: string;
  status?: string;
  verdict: string;
  blockers: string[];
  completedAt?: string;
  createdAt?: string;
  path?: string;
}

export interface ReadLatestStartupReadinessSnapshotOptions {
  root: string;
  stateDb: string;
  stage?: string;
  target?: string;
}

interface StartupReadinessSnapshotEventRow {
  payload_json: string;
  created_at: string;
}

export function readLatestStartupReadinessSnapshot(
  options: ReadLatestStartupReadinessSnapshotOptions
): StartupReadinessVerdictSnapshot | undefined {
  const snapshots = [
    ...readStartupReadinessSnapshotEvents(options),
    ...readStartupReadinessSnapshotFiles(options)
  ]
    .filter((snapshot) => snapshotMatchesTarget(snapshot, options))
    .sort((left, right) =>
      startupReadinessSnapshotTime(right).localeCompare(
        startupReadinessSnapshotTime(left)
      )
    );

  return snapshots[0];
}

function readStartupReadinessSnapshotEvents(
  options: ReadLatestStartupReadinessSnapshotOptions
): StartupReadinessVerdictSnapshot[] {
  const database = openRunsteadDatabase(options.stateDb);

  try {
    const rows = database
      .prepare(
        `
        SELECT payload_json, created_at
        FROM events
        WHERE type = 'startup_readiness.run_snapshot'
          AND aggregate_type = 'startup_readiness_run'
        ORDER BY created_at DESC, id DESC
      `
      )
      .all() as unknown as StartupReadinessSnapshotEventRow[];

    return rows
      .map((row) => startupReadinessSnapshotFromUnknown(row.payload_json, row.created_at))
      .filter(
        (snapshot): snapshot is StartupReadinessVerdictSnapshot =>
          snapshot !== undefined
      );
  } finally {
    database.close();
  }
}

function readStartupReadinessSnapshotFiles(
  options: ReadLatestStartupReadinessSnapshotOptions
): StartupReadinessVerdictSnapshot[] {
  return startupReadinessRunDirs(options.root).flatMap((runsDir) =>
    readdirSync(runsDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => startupReadinessSnapshotFromFile(join(runsDir, name)))
      .filter(
        (snapshot): snapshot is StartupReadinessVerdictSnapshot =>
          snapshot !== undefined
      )
  );
}

function startupReadinessRunDirs(root: string): string[] {
  return [
    join(root, "startup", "readiness-runs"),
    join(root, "startup", "runs")
  ].filter((path) => existsSync(path));
}

function startupReadinessSnapshotFromFile(
  path: string
): StartupReadinessVerdictSnapshot | undefined {
  try {
    return startupReadinessSnapshotFromUnknown(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function startupReadinessSnapshotFromUnknown(
  input: unknown,
  createdAt?: string
): StartupReadinessVerdictSnapshot | undefined {
  let parsed = input;

  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch {
      return undefined;
    }
  }

  if (
    !isRecord(parsed) ||
    typeof parsed.verdict !== "string" ||
    typeof parsed.target !== "string"
  ) {
    return undefined;
  }

  const runId =
    typeof parsed.runId === "string"
      ? parsed.runId
      : typeof parsed.id === "string"
        ? parsed.id
        : undefined;

  if (runId === undefined) {
    return undefined;
  }

  return {
    runId,
    ...(typeof parsed.stage === "string" ? { stage: parsed.stage } : {}),
    target: parsed.target,
    ...(typeof parsed.status === "string" ? { status: parsed.status } : {}),
    verdict: parsed.verdict,
    blockers: Array.isArray(parsed.verdictBlockers)
      ? parsed.verdictBlockers.filter(
          (blocker): blocker is string => typeof blocker === "string"
        )
      : [],
    ...(typeof parsed.completedAt === "string"
      ? { completedAt: parsed.completedAt }
      : {}),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(typeof parsed.path === "string" ? { path: parsed.path } : {})
  };
}

function snapshotMatchesTarget(
  snapshot: StartupReadinessVerdictSnapshot,
  options: ReadLatestStartupReadinessSnapshotOptions
): boolean {
  if (options.stage !== undefined && snapshot.stage !== options.stage) {
    return false;
  }

  return options.target === undefined || snapshot.target === options.target;
}

function startupReadinessSnapshotTime(
  snapshot: StartupReadinessVerdictSnapshot
): string {
  return snapshot.completedAt ?? snapshot.createdAt ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
