import { accessSync, constants } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  createRunsteadId,
  MemoryRecordSchema,
  MemoryTypeSchema,
  type JsonObject,
  type MemoryRecord,
  type RunsteadEvent
} from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { resolveRunsteadRootSync } from "./runstead-root.js";

export interface QuarantineMemoryCandidateOptions {
  cwd?: string;
  scope: string;
  type: string;
  content: string;
  sourceRefs?: string[];
  confidence?: number;
  createdBy?: string;
  taskId?: string;
  now?: Date;
}

export interface QuarantineMemoryCandidateResult {
  memory: MemoryRecord;
  event: RunsteadEvent;
  stateDb: string;
}

export interface RecordProjectFactOptions {
  cwd?: string;
  scope: string;
  content: string;
  sourceRefs: string[];
  confidence?: number;
  createdBy?: string;
  taskId?: string;
  now?: Date;
}

export interface RecordProjectFactResult {
  memory: MemoryRecord;
  event: RunsteadEvent;
  stateDb: string;
}

export interface ListProjectFactsOptions {
  cwd?: string;
  scope?: string;
}

export interface ListProjectFactsResult {
  facts: MemoryRecord[];
  stateDb: string;
}

export function quarantineMemoryCandidate(
  options: QuarantineMemoryCandidateOptions
): QuarantineMemoryCandidateResult {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedRoot = resolveRunsteadRootSync(cwd);

  if (resolvedRoot.source === "missing") {
    throw new Error(`Runstead is not initialized at ${resolvedRoot.root}`);
  }

  const createdAt = (options.now ?? new Date()).toISOString();
  const memory = MemoryRecordSchema.parse({
    id: createRunsteadId("mem"),
    scope: options.scope,
    type: MemoryTypeSchema.parse(options.type),
    status: "quarantined",
    confidence: options.confidence ?? 0.5,
    content: options.content,
    sourceRefs: options.sourceRefs ?? [],
    provenance: provenance({
      ...(options.createdBy === undefined ? {} : { createdBy: options.createdBy }),
      ...(options.taskId === undefined ? {} : { taskId: options.taskId })
    }),
    createdAt,
    updatedAt: createdAt,
    conflictsWith: []
  });
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "memory.candidate_quarantined",
    aggregateType: "memory",
    aggregateId: memory.id,
    payload: memoryEventPayload(memory),
    createdAt
  };
  const stateDb = join(resolvedRoot.root, "state.db");
  const database = openRunsteadDatabase(stateDb);

  try {
    appendEventAndProject(database, {
      event,
      projection: {
        type: "memory",
        value: memory
      }
    });
  } finally {
    database.close();
  }

  return {
    memory,
    event,
    stateDb
  };
}

export function recordProjectFact(
  options: RecordProjectFactOptions
): RecordProjectFactResult {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedRoot = resolveRunsteadRootSync(cwd);

  if (resolvedRoot.source === "missing") {
    throw new Error(`Runstead is not initialized at ${resolvedRoot.root}`);
  }

  validateProjectFactSources(cwd, options.sourceRefs);

  const createdAt = (options.now ?? new Date()).toISOString();
  const memory = MemoryRecordSchema.parse({
    id: createRunsteadId("mem"),
    scope: options.scope,
    type: "project_fact",
    status: "verified",
    confidence: options.confidence ?? 0.95,
    content: options.content,
    sourceRefs: options.sourceRefs,
    provenance: provenance({
      ...(options.createdBy === undefined ? {} : { createdBy: options.createdBy }),
      ...(options.taskId === undefined ? {} : { taskId: options.taskId })
    }),
    createdAt,
    updatedAt: createdAt,
    conflictsWith: []
  });
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "memory.project_fact_verified",
    aggregateType: "memory",
    aggregateId: memory.id,
    payload: memoryEventPayload(memory),
    createdAt
  };
  const stateDb = join(resolvedRoot.root, "state.db");
  const database = openRunsteadDatabase(stateDb);

  try {
    appendEventAndProject(database, {
      event,
      projection: {
        type: "memory",
        value: memory
      }
    });
  } finally {
    database.close();
  }

  return {
    memory,
    event,
    stateDb
  };
}

export function listProjectFacts(
  options: ListProjectFactsOptions = {}
): ListProjectFactsResult {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedRoot = resolveRunsteadRootSync(cwd);

  if (resolvedRoot.source === "missing") {
    throw new Error(`Runstead is not initialized at ${resolvedRoot.root}`);
  }

  const stateDb = join(resolvedRoot.root, "state.db");
  const database = openRunsteadDatabase(stateDb);

  try {
    const rows =
      options.scope === undefined
        ? (database
            .prepare(
              `
              SELECT id, scope, type, status, confidence, content,
                     source_refs_json, provenance_json, created_at, updated_at,
                     expires_at, conflicts_with_json
              FROM memory_records
              WHERE type = 'project_fact' AND status = 'verified'
              ORDER BY created_at DESC, id ASC
            `
            )
            .all() as unknown as MemoryRow[])
        : (database
            .prepare(
              `
              SELECT id, scope, type, status, confidence, content,
                     source_refs_json, provenance_json, created_at, updated_at,
                     expires_at, conflicts_with_json
              FROM memory_records
              WHERE type = 'project_fact' AND status = 'verified' AND scope = ?
              ORDER BY created_at DESC, id ASC
            `
            )
            .all(options.scope) as unknown as MemoryRow[]);

    return {
      facts: rows.map(rowToMemory),
      stateDb
    };
  } finally {
    database.close();
  }
}

function provenance(input: { createdBy?: string; taskId?: string }): JsonObject {
  return {
    createdBy: input.createdBy ?? "runstead",
    ...(input.taskId === undefined ? {} : { createdFromTask: input.taskId })
  };
}

function memoryEventPayload(memory: MemoryRecord): JsonObject {
  return {
    memoryId: memory.id,
    scope: memory.scope,
    type: memory.type,
    status: memory.status,
    confidence: memory.confidence,
    sourceRefs: memory.sourceRefs,
    provenance: memory.provenance
  };
}

function validateProjectFactSources(cwd: string, sourceRefs: string[]): void {
  if (sourceRefs.length === 0) {
    throw new Error("Project facts require at least one file: source reference");
  }

  for (const sourceRef of sourceRefs) {
    const filePath = sourceRefPath(sourceRef);
    const resolvedPath = resolve(cwd, filePath);
    const relativePath = relative(cwd, resolvedPath);

    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error(`Project fact source escapes the workspace: ${sourceRef}`);
    }

    accessSync(resolvedPath, constants.R_OK);
  }
}

function sourceRefPath(sourceRef: string): string {
  if (!sourceRef.startsWith("file:")) {
    throw new Error(`Project facts can only be verified from file: sources`);
  }

  const filePath = sourceRef.slice("file:".length);

  if (filePath.length === 0) {
    throw new Error("Project fact file source cannot be empty");
  }

  return filePath;
}

interface MemoryRow {
  id: string;
  scope: string;
  type: string;
  status: string;
  confidence: number;
  content: string;
  source_refs_json: string;
  provenance_json: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  conflicts_with_json: string;
}

function rowToMemory(row: MemoryRow): MemoryRecord {
  return MemoryRecordSchema.parse({
    id: row.id,
    scope: row.scope,
    type: row.type,
    status: row.status,
    confidence: row.confidence,
    content: row.content,
    sourceRefs: JSON.parse(row.source_refs_json) as string[],
    provenance: JSON.parse(row.provenance_json) as JsonObject,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
    conflictsWith: JSON.parse(row.conflicts_with_json) as string[]
  });
}
