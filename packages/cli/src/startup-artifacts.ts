import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  STARTUP_STRUCTURED_ARTIFACT_SCHEMA,
  STARTUP_STRUCTURED_ARTIFACT_SCHEMA_VERSION,
  StartupStructuredArtifactSchema,
  migrateStartupArtifact,
  type StartupStructuredArtifact,
  type WriteStartupStructuredArtifactOptions
} from "./startup-artifact-schema.js";
export {
  formatStartupArtifactList,
  formatStartupArtifactShow
} from "./startup-artifact-format.js";
export {
  STARTUP_STRUCTURED_ARTIFACT_SCHEMA,
  STARTUP_STRUCTURED_ARTIFACT_SCHEMA_VERSION,
  StartupStructuredArtifactSchema,
  migrateStartupArtifact,
  type StartupStructuredArtifact,
  type WriteStartupStructuredArtifactOptions
} from "./startup-artifact-schema.js";
import { startupEvidenceSourceRefIndex } from "./startup-artifact-source-refs.js";

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

export async function readStartupStructuredArtifact(
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

export async function writeStartupStructuredArtifact(
  input: WriteStartupStructuredArtifactOptions
): Promise<string> {
  const structuredPath =
    input.structuredPath ?? structuredArtifactPath(input.markdownPath);
  const artifact: StartupStructuredArtifact = {
    schemaVersion: STARTUP_STRUCTURED_ARTIFACT_SCHEMA_VERSION,
    schema: STARTUP_STRUCTURED_ARTIFACT_SCHEMA,
    kind: input.kind,
    generatedAt: input.generatedAt,
    markdownPath: input.markdownPath,
    data: input.data
  };

  await mkdir(dirname(structuredPath), { recursive: true });
  await writeTextFileIfChanged(
    structuredPath,
    `${JSON.stringify(artifact, null, 2)}\n`
  );

  return structuredPath;
}

export async function stableStartupGeneratedAt(input: {
  kind: string;
  markdownPath: string;
  data: Record<string, unknown>;
  fallback: string;
}): Promise<string> {
  const existing = await readStartupStructuredArtifact(
    structuredArtifactPath(input.markdownPath)
  );

  if (
    existing?.kind === input.kind &&
    JSON.stringify(existing.data) === JSON.stringify(input.data)
  ) {
    return existing.generatedAt;
  }

  return input.fallback;
}

export function stableRepoInspectionData(inspection: object): Record<string, unknown> {
  const stableInspection = { ...inspection } as Record<string, unknown>;

  delete stableInspection.inspectedAt;

  return stableInspection;
}

export async function writeTextFileIfChanged(
  path: string,
  content: string
): Promise<void> {
  try {
    if ((await readFile(path, "utf8")) === content) {
      return;
    }
  } catch {
    // Missing files are created below.
  }

  await writeFile(path, content, "utf8");
}

export function structuredArtifactPath(markdownPath: string): string {
  return markdownPath.endsWith(".md")
    ? `${markdownPath.slice(0, -3)}.json`
    : `${markdownPath}.json`;
}

export function structuredArtifactFileName(markdownFileName: string): string {
  return markdownFileName.endsWith(".md")
    ? `${markdownFileName.slice(0, -3)}.json`
    : `${markdownFileName}.json`;
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
