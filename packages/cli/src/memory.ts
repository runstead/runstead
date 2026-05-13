import { join, resolve } from "node:path";

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
