import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

interface EvidenceRefRow {
  id: string;
  type: string;
  uri: string;
  created_at: string;
}

export async function artifactFiles(dir: string): Promise<string[]> {
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

export async function startupArtifactReferences(root: string): Promise<{
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
            const parsed = JSON.parse(await readFile(path, "utf8")) as {
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

export function evidenceArtifactReferences(stateDb: string): {
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

export function mergeReferenceMaps(
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

function evidenceFilePath(uri: string): string | undefined {
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
