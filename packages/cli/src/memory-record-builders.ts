import type { JsonObject, MemoryRecord } from "@runstead/core";

const MAX_QUARANTINED_MEMORY_CONFIDENCE = 0.8;

export function memoryProvenance(input: {
  createdBy?: string;
  taskId?: string;
}): JsonObject {
  return {
    createdBy: input.createdBy ?? "runstead",
    ...(input.taskId === undefined ? {} : { createdFromTask: input.taskId })
  };
}

export function quarantinedMemoryConfidence(confidence: number | undefined): number {
  const value = confidence ?? 0.5;

  if (value < 0 || value > 1) {
    throw new Error("Memory confidence must be between 0 and 1");
  }

  return Math.min(value, MAX_QUARANTINED_MEMORY_CONFIDENCE);
}

export function memoryEventPayload(memory: MemoryRecord): JsonObject {
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
