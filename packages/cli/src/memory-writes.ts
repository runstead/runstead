import { resolve } from "node:path";

import {
  createRunsteadId,
  MemoryRecordSchema,
  MemoryTypeSchema,
  type RunsteadEvent
} from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { readProjectFacts } from "./memory-query.js";
import {
  memoryEventPayload,
  memoryProvenance,
  quarantinedMemoryConfidence
} from "./memory-record-builders.js";
import type {
  QuarantineMemoryCandidateOptions,
  QuarantineMemoryCandidateResult,
  RecordProjectFactOptions,
  RecordProjectFactResult
} from "./memory-types.js";
import {
  rejectDuplicateProjectFact,
  validateMemoryTimestamp,
  validateProjectFactConflictRefs,
  validateProjectFactSources
} from "./memory-validation.js";
import { requireRunsteadStateDbSync } from "./runstead-root.js";

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
    provenance: memoryProvenance({
      ...(options.createdBy === undefined ? {} : { createdBy: options.createdBy }),
      ...(options.taskId === undefined ? {} : { taskId: options.taskId }),
      ...(options.candidateKey === undefined
        ? {}
        : { candidateKey: options.candidateKey }),
      ...(options.proposal === undefined ? {} : { proposal: options.proposal })
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
      provenance: memoryProvenance({
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
