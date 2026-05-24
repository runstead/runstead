import { readdir, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDb } from "./runstead-root.js";

const STARTUP_ARTIFACT_DIRS = ["evidence", "reports", "startup", "logs", "checkpoints"];

export interface StartupArtifactHygieneOptions {
  cwd?: string;
  retentionDays?: number;
  prune?: boolean;
  now?: Date;
}

export interface StartupArtifactHygieneResult {
  root: string;
  stateDb: string;
  generatedAt: string;
  retentionDays: number;
  pruned: boolean;
  reportPath: string;
  jsonPath: string;
  latestPath: string;
  summary: {
    totalFiles: number;
    currentFiles: number;
    referencedFiles: number;
    supersededFiles: number;
    unreferencedFiles: number;
    pruneCandidates: number;
    deletedFiles: number;
    totalBytes: number;
    candidateBytes: number;
  };
  latest: {
    readinessRun?: string;
    evidenceByType: Record<string, string>;
  };
  files: StartupArtifactHygieneFile[];
  pruneCandidates: StartupArtifactHygieneFile[];
  deletedFiles: string[];
}

export interface StartupArtifactHygieneFile {
  path: string;
  relativePath: string;
  directory: string;
  sizeBytes: number;
  modifiedAt: string;
  ageDays: number;
  layer: "current" | "referenced" | "superseded" | "unreferenced";
  referencedBy: string[];
  pruneCandidate: boolean;
}

interface EvidenceRefRow {
  id: string;
  type: string;
  uri: string;
  created_at: string;
}

export async function manageStartupArtifactHygiene(
  options: StartupArtifactHygieneOptions = {}
): Promise<StartupArtifactHygieneResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolved = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const retentionDays = options.retentionDays ?? 30;
  const nowMs = Date.parse(generatedAt);
  const references = await startupArtifactReferences(resolved.root);
  const evidence = evidenceArtifactReferences(resolved.stateDb);
  const allReferences = mergeReferenceMaps(references.references, evidence.references);
  const files = await startupArtifactFiles({
    root: resolved.root,
    generatedAt,
    nowMs,
    retentionDays,
    references: allReferences,
    currentPaths: new Set([...references.currentPaths, ...evidence.currentPaths]),
    supersededPaths: evidence.supersededPaths
  });
  const pruneCandidates = files.filter((file) => file.pruneCandidate);
  const deletedFiles: string[] = [];

  if (options.prune === true) {
    for (const file of pruneCandidates) {
      await rm(file.path, { force: true });
      deletedFiles.push(file.path);
    }
  }

  const result: StartupArtifactHygieneResult = {
    root: resolved.root,
    stateDb: resolved.stateDb,
    generatedAt,
    retentionDays,
    pruned: options.prune === true,
    reportPath: join(resolved.root, "reports", "startup-artifact-hygiene.md"),
    jsonPath: join(resolved.root, "reports", "startup-artifact-hygiene.json"),
    latestPath: join(resolved.root, "startup", "latest-artifacts.json"),
    summary: startupArtifactHygieneSummary(files, pruneCandidates, deletedFiles),
    latest: {
      ...(references.latestRun === undefined
        ? {}
        : { readinessRun: references.latestRun }),
      evidenceByType: evidence.latestEvidenceByType
    },
    files,
    pruneCandidates,
    deletedFiles
  };

  await writeStartupArtifactHygieneResult(result);

  return result;
}

export function formatStartupArtifactHygiene(
  result: StartupArtifactHygieneResult
): string {
  return [
    "Startup artifact hygiene",
    `Root: ${result.root}`,
    `Retention: ${result.retentionDays} days`,
    `Mode: ${result.pruned ? "prune" : "report-only"}`,
    `Files: ${result.summary.totalFiles}`,
    `Current: ${result.summary.currentFiles}`,
    `Referenced: ${result.summary.referencedFiles}`,
    `Superseded: ${result.summary.supersededFiles}`,
    `Unreferenced: ${result.summary.unreferencedFiles}`,
    `Prune candidates: ${result.summary.pruneCandidates}`,
    `Deleted: ${result.summary.deletedFiles}`,
    `Latest view: ${result.latestPath}`,
    `Report: ${result.reportPath}`,
    `JSON: ${result.jsonPath}`
  ].join("\n");
}

async function startupArtifactFiles(input: {
  root: string;
  generatedAt: string;
  nowMs: number;
  retentionDays: number;
  references: Map<string, string[]>;
  currentPaths: Set<string>;
  supersededPaths: Set<string>;
}): Promise<StartupArtifactHygieneFile[]> {
  const paths = (
    await Promise.all(
      STARTUP_ARTIFACT_DIRS.map((dir) => artifactFiles(join(input.root, dir)))
    )
  )
    .flat()
    .filter((path) => !path.endsWith("startup-artifact-hygiene.json"))
    .sort((left, right) => left.localeCompare(right));
  const rows: StartupArtifactHygieneFile[] = [];

  for (const path of paths) {
    const info = await stat(path);
    const references = input.references.get(path) ?? [];
    const ageDays = Math.max(
      0,
      Math.floor((input.nowMs - info.mtime.getTime()) / 86_400_000)
    );
    const layer = artifactLayer({
      path,
      references,
      currentPaths: input.currentPaths,
      supersededPaths: input.supersededPaths
    });

    rows.push({
      path,
      relativePath: relative(input.root, path),
      directory: relative(input.root, path).split(/[\\/]/)[0] ?? ".",
      sizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
      ageDays,
      layer,
      referencedBy: references,
      pruneCandidate: layer === "unreferenced" && ageDays >= input.retentionDays
    });
  }

  return rows;
}

function artifactLayer(input: {
  path: string;
  references: string[];
  currentPaths: Set<string>;
  supersededPaths: Set<string>;
}): StartupArtifactHygieneFile["layer"] {
  if (input.currentPaths.has(input.path)) {
    return "current";
  }

  if (input.supersededPaths.has(input.path)) {
    return "superseded";
  }

  return input.references.length === 0 ? "unreferenced" : "referenced";
}

async function artifactFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const path = join(dir, entry.name);

        if (entry.isDirectory()) {
          return artifactFiles(path);
        }

        return entry.isFile() ? [path] : [];
      })
    );

    return nested.flat();
  } catch {
    return [];
  }
}

async function startupArtifactReferences(root: string): Promise<{
  latestRun?: string;
  currentPaths: Set<string>;
  references: Map<string, string[]>;
}> {
  const runFiles = await artifactFiles(join(root, "startup", "readiness-runs"));
  const runs = (
    await Promise.all(
      runFiles
        .filter((path) => path.endsWith(".json"))
        .map(async (path) => {
          try {
            const parsed = JSON.parse(
              await import("node:fs/promises").then((fs) => fs.readFile(path, "utf8"))
            ) as {
              id?: unknown;
              completedAt?: unknown;
              startedAt?: unknown;
              reportPaths?: unknown;
              phases?: unknown;
            };

            return { path, parsed };
          } catch {
            return undefined;
          }
        })
    )
  ).filter((item): item is NonNullable<typeof item> => item !== undefined);
  const references = new Map<string, string[]>();

  for (const run of runs) {
    const runId = typeof run.parsed.id === "string" ? run.parsed.id : run.path;

    addReference(references, run.path, `readiness_run:${runId}`);
    for (const path of startupRunArtifactPaths(run.parsed)) {
      addReference(references, path, `readiness_run:${runId}`);
    }
  }

  runs.sort((left, right) =>
    startupRunTimestamp(right.parsed).localeCompare(startupRunTimestamp(left.parsed))
  );

  const latestRun = runs[0];
  const currentPaths = new Set<string>();

  if (latestRun !== undefined) {
    const latestRunId =
      typeof latestRun.parsed.id === "string" ? latestRun.parsed.id : latestRun.path;

    currentPaths.add(latestRun.path);
    for (const path of startupRunArtifactPaths(latestRun.parsed)) {
      currentPaths.add(path);
    }

    return {
      latestRun: latestRunId,
      currentPaths,
      references
    };
  }

  return {
    currentPaths,
    references
  };
}

function startupRunArtifactPaths(run: {
  reportPaths?: unknown;
  phases?: unknown;
}): string[] {
  const reportPaths = Array.isArray(run.reportPaths)
    ? run.reportPaths.filter((path): path is string => typeof path === "string")
    : [];
  const phasePaths = Array.isArray(run.phases)
    ? run.phases.flatMap((phase) =>
        isRecord(phase) && Array.isArray(phase.artifacts)
          ? phase.artifacts.filter((path): path is string => typeof path === "string")
          : []
      )
    : [];

  return [...reportPaths, ...phasePaths];
}

function startupRunTimestamp(run: {
  completedAt?: unknown;
  startedAt?: unknown;
}): string {
  return (
    (typeof run.completedAt === "string" ? run.completedAt : undefined) ??
    (typeof run.startedAt === "string" ? run.startedAt : undefined) ??
    ""
  );
}

function evidenceArtifactReferences(stateDb: string): {
  currentPaths: Set<string>;
  supersededPaths: Set<string>;
  latestEvidenceByType: Record<string, string>;
  references: Map<string, string[]>;
} {
  const database = openRunsteadDatabase(stateDb);

  try {
    const rows = database
      .prepare(
        `
        SELECT id, type, uri, created_at
        FROM evidence
        ORDER BY created_at DESC, id ASC
      `
      )
      .all() as unknown as EvidenceRefRow[];
    const references = new Map<string, string[]>();
    const currentPaths = new Set<string>();
    const supersededPaths = new Set<string>();
    const latestByType = new Map<string, EvidenceRefRow>();

    for (const row of rows) {
      const current = latestByType.get(row.type);

      if (
        current === undefined ||
        row.created_at.localeCompare(current.created_at) > 0
      ) {
        latestByType.set(row.type, row);
      }

      const path = evidenceFilePath(row.uri);

      if (path !== undefined) {
        addReference(references, path, `evidence:${row.id}`);
      }
    }

    for (const row of rows) {
      const path = evidenceFilePath(row.uri);

      if (path === undefined) {
        continue;
      }

      if (latestByType.get(row.type)?.id === row.id) {
        currentPaths.add(path);
      } else {
        supersededPaths.add(path);
      }
    }

    return {
      currentPaths,
      supersededPaths,
      latestEvidenceByType: Object.fromEntries(
        [...latestByType.entries()].map(([type, row]) => [type, row.id])
      ),
      references
    };
  } finally {
    database.close();
  }
}

function evidenceFilePath(uri: string): string | undefined {
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

function mergeReferenceMaps(
  left: Map<string, string[]>,
  right: Map<string, string[]>
): Map<string, string[]> {
  const merged = new Map<string, string[]>();

  for (const [path, values] of [...left.entries(), ...right.entries()]) {
    const current = merged.get(path) ?? [];

    merged.set(path, [...current, ...values]);
  }

  return merged;
}

function addReference(
  references: Map<string, string[]>,
  path: string,
  ref: string
): void {
  const current = references.get(path) ?? [];

  if (!current.includes(ref)) {
    references.set(path, [...current, ref]);
  }
}

function startupArtifactHygieneSummary(
  files: StartupArtifactHygieneFile[],
  pruneCandidates: StartupArtifactHygieneFile[],
  deletedFiles: string[]
): StartupArtifactHygieneResult["summary"] {
  return {
    totalFiles: files.length,
    currentFiles: files.filter((file) => file.layer === "current").length,
    referencedFiles: files.filter((file) => file.layer === "referenced").length,
    supersededFiles: files.filter((file) => file.layer === "superseded").length,
    unreferencedFiles: files.filter((file) => file.layer === "unreferenced").length,
    pruneCandidates: pruneCandidates.length,
    deletedFiles: deletedFiles.length,
    totalBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    candidateBytes: pruneCandidates.reduce((total, file) => total + file.sizeBytes, 0)
  };
}

async function writeStartupArtifactHygieneResult(
  result: StartupArtifactHygieneResult
): Promise<void> {
  await mkdir(join(result.root, "reports"), { recursive: true });
  await mkdir(join(result.root, "startup"), { recursive: true });
  await writeFile(
    result.jsonPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: result.generatedAt,
        retentionDays: result.retentionDays,
        pruned: result.pruned,
        summary: result.summary,
        latest: result.latest,
        files: result.files,
        pruneCandidates: result.pruneCandidates,
        deletedFiles: result.deletedFiles
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    result.latestPath,
    `${JSON.stringify(result.latest, null, 2)}\n`,
    "utf8"
  );
  await writeFile(result.reportPath, startupArtifactHygieneMarkdown(result), "utf8");
}

function startupArtifactHygieneMarkdown(result: StartupArtifactHygieneResult): string {
  return [
    "# Startup Artifact Hygiene",
    "",
    `Generated: ${result.generatedAt}`,
    `Retention days: ${result.retentionDays}`,
    `Mode: ${result.pruned ? "prune" : "report-only"}`,
    "",
    "## Summary",
    "",
    `- total_files: ${result.summary.totalFiles}`,
    `- current_files: ${result.summary.currentFiles}`,
    `- referenced_files: ${result.summary.referencedFiles}`,
    `- superseded_files: ${result.summary.supersededFiles}`,
    `- unreferenced_files: ${result.summary.unreferencedFiles}`,
    `- prune_candidates: ${result.summary.pruneCandidates}`,
    `- deleted_files: ${result.summary.deletedFiles}`,
    "",
    "## Latest View",
    "",
    `- readiness_run: ${result.latest.readinessRun ?? "none"}`,
    ...Object.entries(result.latest.evidenceByType).map(
      ([type, id]) => `- ${type}: ${id}`
    ),
    "",
    "## Prune Candidates",
    "",
    result.pruneCandidates.length === 0
      ? "- none"
      : result.pruneCandidates
          .slice(0, 50)
          .map(
            (file) =>
              `- ${file.relativePath} age=${file.ageDays}d bytes=${file.sizeBytes}`
          )
          .join("\n")
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
