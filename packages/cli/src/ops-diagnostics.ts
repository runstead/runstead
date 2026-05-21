import { constants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile
} from "node:fs/promises";
import { join, resolve } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { doctorRunstead, type DoctorCheck } from "./doctor.js";
import { readDaemonStatus, type DaemonHeartbeatStatus } from "./daemon.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { REQUIRED_STATE_TABLES } from "./state-schema.js";

export interface GenerateOpsDiagnosticsOptions {
  cwd?: string;
  includeStateBackup?: boolean;
  retentionDays?: number;
  now?: Date;
}

export interface OpsDiagnosticsBundleResult {
  root: string;
  stateDb: string;
  markdownPath: string;
  jsonPath: string;
  stateBackupPath?: string;
  summary: OpsDiagnosticsSummary;
}

export interface OpsDiagnosticsSummary {
  generatedAt: string;
  doctorOk: boolean;
  failedChecks: string[];
  daemon?: DaemonHeartbeatStatus;
  managerLock: ManagerLockSnapshot;
  stateTables: Record<string, number>;
  artifacts: Record<string, ArtifactDirectorySnapshot>;
  retention: {
    retentionDays: number;
    cleanupCandidates: string[];
  };
  timeoutProfiles: Record<string, string>;
}

export interface ManagerLockSnapshot {
  path: string;
  status: "missing" | "present" | "unreadable";
  ownerId?: string;
  heartbeatAt?: string;
}

export interface ArtifactDirectorySnapshot {
  path: string;
  files: number;
  bytes: number;
}

const ARTIFACT_DIRECTORIES = ["evidence", "reports", "startup", "logs", "checkpoints"];
const TIMEOUT_PROFILES = {
  git: "30s default for repository inspection; 60s for branch operations",
  verifier: "15s startup dogfood default; caller may pass --timeout-ms",
  worker: "external worker timeout is controlled by wrapped worker runner",
  daemon: "30s tick interval by default"
};

export async function generateOpsDiagnosticsBundle(
  options: GenerateOpsDiagnosticsOptions = {}
): Promise<OpsDiagnosticsBundleResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const safeTimestamp = generatedAt.replace(/[:.]/g, "-");
  const diagnosticsDir = join(state.root, "diagnostics");
  const markdownPath = join(diagnosticsDir, `ops-diagnostics-${safeTimestamp}.md`);
  const jsonPath = join(diagnosticsDir, `ops-diagnostics-${safeTimestamp}.json`);
  const stateBackupPath =
    options.includeStateBackup === false
      ? undefined
      : join(diagnosticsDir, `state-${safeTimestamp}.db`);
  const doctor = await doctorRunstead({ cwd });
  const [daemon, managerLock, artifacts] = await Promise.all([
    readOptionalDaemon(cwd, options.now),
    readManagerLock(state.root),
    readArtifactSnapshots(state.root)
  ]);
  const stateTables = readStateTableCounts(state.stateDb);
  const summary: OpsDiagnosticsSummary = {
    generatedAt,
    doctorOk: doctor.ok,
    failedChecks: doctor.checks
      .filter((check) => check.status === "fail")
      .map((check) => check.id),
    ...(daemon === undefined ? {} : { daemon }),
    managerLock,
    stateTables,
    artifacts,
    retention: retentionPlan({
      artifacts,
      retentionDays: options.retentionDays ?? 30
    }),
    timeoutProfiles: TIMEOUT_PROFILES
  };

  await mkdir(diagnosticsDir, { recursive: true });
  await writeFile(
    markdownPath,
    formatOpsDiagnostics({ summary, doctorChecks: doctor.checks }),
    "utf8"
  );
  await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (stateBackupPath !== undefined) {
    await copyFile(state.stateDb, stateBackupPath);
  }

  return {
    root: state.root,
    stateDb: state.stateDb,
    markdownPath,
    jsonPath,
    ...(stateBackupPath === undefined ? {} : { stateBackupPath }),
    summary
  };
}

async function readOptionalDaemon(
  cwd: string,
  now: Date | undefined
): Promise<DaemonHeartbeatStatus | undefined> {
  try {
    return await readDaemonStatus({
      cwd,
      staleAfterMs: 2 * 60 * 1_000,
      ...(now === undefined ? {} : { now })
    });
  } catch {
    return undefined;
  }
}

async function readManagerLock(root: string): Promise<ManagerLockSnapshot> {
  const path = join(root, "manager.lock");

  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;

    if (!isRecord(parsed)) {
      return { path, status: "unreadable" };
    }

    return {
      path,
      status: "present",
      ...(typeof parsed.ownerId === "string" ? { ownerId: parsed.ownerId } : {}),
      ...(typeof parsed.heartbeatAt === "string"
        ? { heartbeatAt: parsed.heartbeatAt }
        : {})
    };
  } catch {
    try {
      await access(path, constants.F_OK);
      return { path, status: "unreadable" };
    } catch {
      return { path, status: "missing" };
    }
  }
}

async function readArtifactSnapshots(
  root: string
): Promise<Record<string, ArtifactDirectorySnapshot>> {
  const entries = await Promise.all(
    ARTIFACT_DIRECTORIES.map(
      async (directory): Promise<[string, ArtifactDirectorySnapshot]> => [
        directory,
        await readArtifactDirectory(join(root, directory))
      ]
    )
  );
  const snapshots: Record<string, ArtifactDirectorySnapshot> = {};

  for (const [directory, snapshot] of entries) {
    snapshots[directory] = snapshot;
  }

  return snapshots;
}

async function readArtifactDirectory(path: string): Promise<ArtifactDirectorySnapshot> {
  let files = 0;
  let bytes = 0;

  async function visit(directory: string): Promise<void> {
    try {
      const entries = await readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = join(directory, String(entry.name));

        if (entry.isDirectory()) {
          await visit(entryPath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        files += 1;
        bytes += (await stat(entryPath)).size;
      }
    } catch {
      return;
    }
  }

  await visit(path);

  return {
    path,
    files,
    bytes
  };
}

function readStateTableCounts(stateDb: string): Record<string, number> {
  const database = openRunsteadDatabase(stateDb);

  try {
    const counts: Record<string, number> = {};

    for (const table of REQUIRED_STATE_TABLES) {
      const row = database
        .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
        .get() as unknown as { count: number };

      counts[table] = row.count;
    }

    return counts;
  } finally {
    database.close();
  }
}

function retentionPlan(input: {
  artifacts: Record<string, ArtifactDirectorySnapshot>;
  retentionDays: number;
}): OpsDiagnosticsSummary["retention"] {
  const cleanupCandidates = Object.entries(input.artifacts)
    .filter(([, snapshot]) => snapshot.files > 100 || snapshot.bytes > 50 * 1024 * 1024)
    .map(
      ([directory, snapshot]) =>
        `${directory}: ${snapshot.files} files, ${snapshot.bytes} bytes`
    );

  return {
    retentionDays: input.retentionDays,
    cleanupCandidates:
      cleanupCandidates.length === 0
        ? ["no artifact directory exceeds cleanup thresholds"]
        : cleanupCandidates
  };
}

function formatOpsDiagnostics(input: {
  summary: OpsDiagnosticsSummary;
  doctorChecks: DoctorCheck[];
}): string {
  return [
    "# Runstead Ops Diagnostics",
    "",
    `Generated: ${input.summary.generatedAt}`,
    `Doctor: ${input.summary.doctorOk ? "ok" : "failed"}`,
    "",
    "## Doctor Checks",
    "",
    listItems(
      input.doctorChecks.map((check) => `${check.status} ${check.id}: ${check.message}`)
    ),
    "",
    "## Daemon",
    "",
    input.summary.daemon === undefined
      ? "- daemon heartbeat not recorded"
      : listItems([
          `tick=${input.summary.daemon.tick}`,
          `stale=${input.summary.daemon.stale ?? false}`,
          `updated=${input.summary.daemon.updatedAt}`
        ]),
    "",
    "## Manager Lock",
    "",
    listItems([
      `status=${input.summary.managerLock.status}`,
      `owner=${input.summary.managerLock.ownerId ?? "none"}`,
      `heartbeat=${input.summary.managerLock.heartbeatAt ?? "none"}`
    ]),
    "",
    "## State Tables",
    "",
    listItems(
      Object.entries(input.summary.stateTables).map(
        ([table, count]) => `${table}: ${count}`
      )
    ),
    "",
    "## Artifact Directories",
    "",
    listItems(
      Object.entries(input.summary.artifacts).map(
        ([directory, snapshot]) =>
          `${directory}: ${snapshot.files} files, ${snapshot.bytes} bytes`
      )
    ),
    "",
    "## Retention And GC",
    "",
    listItems(input.summary.retention.cleanupCandidates),
    "",
    "## Timeout And Retry Profiles",
    "",
    listItems(
      Object.entries(input.summary.timeoutProfiles).map(
        ([profile, value]) => `${profile}: ${value}`
      )
    ),
    ""
  ].join("\n");
}

function listItems(items: string[]): string {
  return items.length === 0 ? "- none" : items.map((item) => `- ${item}`).join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
