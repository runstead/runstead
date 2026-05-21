import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";
import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDb } from "./runstead-root.js";

export const STARTUP_STRUCTURED_ARTIFACT_SCHEMA = "runstead.startupArtifact";
export const STARTUP_STRUCTURED_ARTIFACT_SCHEMA_VERSION = 1;

export const StartupStructuredArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  schema: z.literal(STARTUP_STRUCTURED_ARTIFACT_SCHEMA),
  kind: z.string().min(1),
  generatedAt: z.string().min(1),
  markdownPath: z.string().min(1),
  data: z.record(z.string(), z.unknown())
});

export type StartupStructuredArtifact = z.infer<typeof StartupStructuredArtifactSchema>;

export interface StartupArtifactListOptions {
  cwd?: string;
}

export interface StartupArtifactShowOptions extends StartupArtifactListOptions {
  ref: string;
}

export interface StartupArtifactListItem {
  id: string;
  path: string;
  kind: string;
  generatedAt: string;
  schemaVersion: 1;
  artifact: StartupStructuredArtifact;
  sourceEvidenceIds: string[];
}

export interface StartupArtifactListResult {
  root: string;
  stateDb: string;
  artifacts: StartupArtifactListItem[];
}

export interface StartupArtifactShowResult {
  root: string;
  stateDb: string;
  artifact: StartupArtifactListItem;
}

interface EvidenceSourceRefRow {
  id: string;
  uri: string;
}

interface StartupEvidenceArtifactFile {
  sourceRefs?: unknown;
}

export async function listStartupArtifacts(
  options: StartupArtifactListOptions = {}
): Promise<StartupArtifactListResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedState = await requireRunsteadStateDb(cwd);
  const paths = await startupArtifactPaths(resolvedState.root);
  const sourceRefIndex = startupEvidenceSourceRefIndex(resolvedState.stateDb);
  const artifacts: StartupArtifactListItem[] = [];

  for (const path of paths) {
    const artifact = await readStartupStructuredArtifact(path);

    if (artifact === undefined) {
      continue;
    }

    artifacts.push({
      id: relative(resolvedState.root, path),
      path,
      kind: artifact.kind,
      generatedAt: artifact.generatedAt,
      schemaVersion: artifact.schemaVersion,
      artifact,
      sourceEvidenceIds: sourceRefIndex.get(path) ?? []
    });
  }

  artifacts.sort((left, right) =>
    left.kind === right.kind
      ? left.path.localeCompare(right.path)
      : left.kind.localeCompare(right.kind)
  );

  return {
    root: resolvedState.root,
    stateDb: resolvedState.stateDb,
    artifacts
  };
}

export async function showStartupArtifact(
  options: StartupArtifactShowOptions
): Promise<StartupArtifactShowResult> {
  const listed = await listStartupArtifacts(options);
  const artifact = listed.artifacts.find((item) =>
    artifactMatchesRef(item, options.ref)
  );

  if (artifact === undefined) {
    throw new Error(`Startup artifact ${options.ref} was not found`);
  }

  return {
    root: listed.root,
    stateDb: listed.stateDb,
    artifact
  };
}

export function formatStartupArtifactList(result: StartupArtifactListResult): string {
  return [
    "Startup artifacts:",
    listOrNone(
      result.artifacts,
      (item) =>
        `- ${item.id} kind=${item.kind} schemaVersion=${item.schemaVersion} evidence=${item.sourceEvidenceIds.length}`
    )
  ].join("\n");
}

export function formatStartupArtifactShow(result: StartupArtifactShowResult): string {
  return `${JSON.stringify(
    {
      id: result.artifact.id,
      path: result.artifact.path,
      kind: result.artifact.kind,
      generatedAt: result.artifact.generatedAt,
      schemaVersion: result.artifact.schemaVersion,
      sourceEvidenceIds: result.artifact.sourceEvidenceIds,
      artifact: result.artifact.artifact
    },
    null,
    2
  )}\n`;
}

async function startupArtifactPaths(root: string): Promise<string[]> {
  const candidateDirs = [join(root, "startup"), join(root, "reports")];
  const paths = await Promise.all(candidateDirs.map((dir) => jsonPaths(dir)));

  return paths.flat();
}

async function jsonPaths(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const paths = await Promise.all(
      entries.map(async (entry) => {
        const path = join(dir, entry.name);

        if (entry.isDirectory()) {
          return jsonPaths(path);
        }

        return entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
      })
    );

    return paths.flat();
  } catch {
    return [];
  }
}

async function readStartupStructuredArtifact(
  path: string
): Promise<StartupStructuredArtifact | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    const migrated = migrateStartupArtifact(parsed);

    return StartupStructuredArtifactSchema.parse(migrated);
  } catch {
    return undefined;
  }
}

export function migrateStartupArtifact(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  if (
    value.schema === undefined &&
    value.schemaVersion === STARTUP_STRUCTURED_ARTIFACT_SCHEMA_VERSION &&
    typeof value.kind === "string" &&
    typeof value.generatedAt === "string" &&
    typeof value.markdownPath === "string" &&
    isRecord(value.data)
  ) {
    return {
      ...value,
      schema: STARTUP_STRUCTURED_ARTIFACT_SCHEMA
    };
  }

  return value;
}

function startupEvidenceSourceRefIndex(stateDb: string): Map<string, string[]> {
  const database = openRunsteadDatabase(stateDb);

  try {
    const rows = database
      .prepare(
        `
        SELECT id, uri
        FROM evidence
        WHERE type LIKE 'startup_%'
        ORDER BY created_at DESC, id ASC
      `
      )
      .all() as unknown as EvidenceSourceRefRow[];
    const index = new Map<string, string[]>();

    for (const row of rows) {
      for (const sourceRef of startupEvidenceSourceRefs(row.uri)) {
        const current = index.get(sourceRef) ?? [];

        current.push(row.id);
        index.set(sourceRef, current);
      }
    }

    return index;
  } finally {
    database.close();
  }
}

function startupEvidenceSourceRefs(uri: string): string[] {
  try {
    const parsed = JSON.parse(
      readFileSync(fileURLToPath(uri), "utf8")
    ) as StartupEvidenceArtifactFile;

    return Array.isArray(parsed.sourceRefs)
      ? parsed.sourceRefs.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function artifactMatchesRef(item: StartupArtifactListItem, ref: string): boolean {
  const resolvedRef = resolve(ref);

  return (
    item.id === ref ||
    item.kind === ref ||
    item.path === ref ||
    item.path === resolvedRef ||
    basename(item.path) === ref
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listOrNone<T>(items: T[], formatter: (item: T) => string): string {
  if (items.length === 0) {
    return "- none";
  }

  return items.map(formatter).join("\n");
}
