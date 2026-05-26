import { accessSync, constants, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import {
  createRunsteadId,
  MemoryRecordSchema,
  MemoryTypeSchema,
  type JsonObject,
  type MemoryRecord,
  type RunsteadEvent
} from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import {
  filterConflictedProjectFacts,
  filterExpiredProjectFacts,
  matchesFactQuery,
  normalizedQuery,
  readProjectFacts
} from "./memory-query.js";
import { requireRunsteadStateDbSync } from "./runstead-root.js";

const MAX_QUARANTINED_MEMORY_CONFIDENCE = 0.8;

export interface QuarantineMemoryCandidateOptions {
  cwd?: string;
  scope: string;
  type: string;
  content: string;
  sourceRefs?: string[];
  confidence?: number;
  expiresAt?: string;
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
  conflictsWith?: string[];
  expiresAt?: string;
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
  includeExpired?: boolean;
  now?: Date;
}

export interface ListProjectFactsResult {
  facts: MemoryRecord[];
  stateDb: string;
}

export interface RetrieveProjectFactsOptions {
  cwd?: string;
  scope?: string;
  query?: string;
  limit?: number;
  includeConflicted?: boolean;
  includeExpired?: boolean;
  now?: Date;
}

export interface RetrieveProjectFactsResult {
  retrievalId: string;
  facts: MemoryRecord[];
  event: RunsteadEvent;
  stateDb: string;
}

export function quarantineMemoryCandidate(
  options: QuarantineMemoryCandidateOptions
): QuarantineMemoryCandidateResult {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedState = requireRunsteadStateDbSync(cwd);

  const createdAt = (options.now ?? new Date()).toISOString();
  const expiresAt =
    options.expiresAt === undefined
      ? undefined
      : validateMemoryTimestamp(options.expiresAt, "expiresAt");
  const memory = MemoryRecordSchema.parse({
    id: createRunsteadId("mem"),
    scope: options.scope,
    type: MemoryTypeSchema.parse(options.type),
    status: "quarantined",
    confidence: quarantinedMemoryConfidence(options.confidence),
    content: options.content,
    sourceRefs: options.sourceRefs ?? [],
    provenance: provenance({
      ...(options.createdBy === undefined ? {} : { createdBy: options.createdBy }),
      ...(options.taskId === undefined ? {} : { taskId: options.taskId })
    }),
    createdAt,
    updatedAt: createdAt,
    ...(expiresAt === undefined ? {} : { expiresAt }),
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
  const stateDb = resolvedState.stateDb;
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
  const resolvedState = requireRunsteadStateDbSync(cwd);

  validateProjectFactSources(cwd, options.sourceRefs);

  const createdAt = (options.now ?? new Date()).toISOString();
  const stateDb = resolvedState.stateDb;
  const database = openRunsteadDatabase(stateDb);

  try {
    const existingFacts = readProjectFacts(database, options.scope);

    rejectDuplicateProjectFact(existingFacts, options.content);
    validateProjectFactConflictRefs(existingFacts, options.conflictsWith ?? []);
    const expiresAt =
      options.expiresAt === undefined
        ? undefined
        : validateMemoryTimestamp(options.expiresAt, "expiresAt");

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
      ...(expiresAt === undefined ? {} : { expiresAt }),
      conflictsWith: options.conflictsWith ?? []
    });
    const event: RunsteadEvent = {
      eventId: createRunsteadId("evt"),
      type: "memory.project_fact_verified",
      aggregateType: "memory",
      aggregateId: memory.id,
      payload: memoryEventPayload(memory),
      createdAt
    };

    appendEventAndProject(database, {
      event,
      projection: {
        type: "memory",
        value: memory
      }
    });

    return {
      memory,
      event,
      stateDb
    };
  } finally {
    database.close();
  }
}

export function listProjectFacts(
  options: ListProjectFactsOptions = {}
): ListProjectFactsResult {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedState = requireRunsteadStateDbSync(cwd);

  const stateDb = resolvedState.stateDb;
  const database = openRunsteadDatabase(stateDb);

  try {
    return {
      facts: filterExpiredProjectFacts({
        facts: readProjectFacts(database, options.scope),
        includeExpired: options.includeExpired === true,
        now: options.now ?? new Date()
      }),
      stateDb
    };
  } finally {
    database.close();
  }
}

export function retrieveProjectFacts(
  options: RetrieveProjectFactsOptions = {}
): RetrieveProjectFactsResult {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedState = requireRunsteadStateDbSync(cwd);

  const limit = options.limit ?? 10;

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("Project fact retrieval limit must be a positive integer");
  }

  const stateDb = resolvedState.stateDb;
  const database = openRunsteadDatabase(stateDb);

  try {
    const projectFacts = filterExpiredProjectFacts({
      facts: readProjectFacts(database, options.scope),
      includeExpired: options.includeExpired === true,
      now: options.now ?? new Date()
    });
    const facts = filterConflictedProjectFacts({
      facts: projectFacts,
      includeConflicted: options.includeConflicted === true
    })
      .filter((fact) => matchesFactQuery(fact, options.query))
      .slice(0, limit);
    const retrievalId = createRunsteadId("retr");
    const createdAt = (options.now ?? new Date()).toISOString();
    const event: RunsteadEvent = {
      eventId: createRunsteadId("evt"),
      type: "memory.retrieval_audited",
      aggregateType: "memory_retrieval",
      aggregateId: retrievalId,
      payload: {
        retrievalId,
        scope: options.scope ?? null,
        query: normalizedQuery(options.query),
        limit,
        includeConflicted: options.includeConflicted === true,
        includeExpired: options.includeExpired === true,
        resultCount: facts.length,
        resultIds: facts.map((fact) => fact.id)
      },
      createdAt
    };

    appendEventAndProject(database, { event });

    return {
      retrievalId,
      facts,
      event,
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

function quarantinedMemoryConfidence(confidence: number | undefined): number {
  const value = confidence ?? 0.5;

  if (value < 0 || value > 1) {
    throw new Error("Memory confidence must be between 0 and 1");
  }

  return Math.min(value, MAX_QUARANTINED_MEMORY_CONFIDENCE);
}

function memoryEventPayload(memory: MemoryRecord): JsonObject {
  return {
    memoryId: memory.id,
    scope: memory.scope,
    type: memory.type,
    status: memory.status,
    confidence: memory.confidence,
    sourceRefs: memory.sourceRefs,
    provenance: memory.provenance,
    ...(memory.expiresAt === undefined ? {} : { expiresAt: memory.expiresAt }),
    conflictsWith: memory.conflictsWith
  };
}

function validateProjectFactSources(cwd: string, sourceRefs: string[]): void {
  if (sourceRefs.length === 0) {
    throw new Error("Project facts require at least one file: source reference");
  }

  const workspaceRoot = realpathSync(cwd);

  for (const sourceRef of sourceRefs) {
    const filePath = sourceRefPath(sourceRef);
    const resolvedPath = resolve(cwd, filePath);
    const relativePath = relative(cwd, resolvedPath);

    if (escapesWorkspace(relativePath)) {
      throw new Error(`Project fact source escapes the workspace: ${sourceRef}`);
    }

    if (lstatSync(resolvedPath).isSymbolicLink()) {
      throw new Error(`Project fact source cannot be a symlink: ${sourceRef}`);
    }

    const realPath = realpathSync(resolvedPath);
    const realRelativePath = relative(workspaceRoot, realPath);

    if (escapesWorkspace(realRelativePath)) {
      throw new Error(`Project fact source escapes the workspace: ${sourceRef}`);
    }

    accessSync(realPath, constants.R_OK);
  }
}

function escapesWorkspace(relativePath: string): boolean {
  return relativePath.startsWith("..") || isAbsolute(relativePath);
}

function rejectDuplicateProjectFact(
  existingFacts: MemoryRecord[],
  content: string
): void {
  const normalized = normalizeFactContent(content);
  const duplicate = existingFacts.find(
    (fact) => normalizeFactContent(fact.content) === normalized
  );

  if (duplicate !== undefined) {
    throw new Error(`Duplicate project fact conflicts with ${duplicate.id}`);
  }
}

function validateProjectFactConflictRefs(
  existingFacts: MemoryRecord[],
  conflictsWith: string[]
): void {
  const ids = new Set(existingFacts.map((fact) => fact.id));
  const missing = conflictsWith.filter((id) => !ids.has(id));

  if (missing.length > 0) {
    throw new Error(
      `Project fact conflict references must point to verified facts in the same scope: ${missing.join(", ")}`
    );
  }
}

function normalizeFactContent(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
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

function validateMemoryTimestamp(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`Memory ${field} must be a valid timestamp`);
  }

  return value;
}
