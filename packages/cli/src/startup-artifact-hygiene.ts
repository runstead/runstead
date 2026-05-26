import { rm, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  artifactFiles,
  evidenceArtifactReferences,
  mergeReferenceMaps,
  startupArtifactReferences
} from "./startup-artifact-hygiene-references.js";
import {
  startupArtifactHygieneSummary,
  writeStartupArtifactHygieneResult
} from "./startup-artifact-hygiene-report.js";

export { formatStartupArtifactHygiene } from "./startup-artifact-hygiene-report.js";

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
