import { realpathSync } from "node:fs";
import { basename, resolve } from "node:path";

import {
  createRunsteadId,
  type Goal,
  type MemoryRecord,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import { appendEventAndProject, type RunsteadDatabase } from "@runstead/state-sqlite";

import { readMemoryRecords } from "./memory-query.js";
import { findRepositoryByLocalPath } from "./repositories-store.js";

const DEFAULT_CONTEXT_MEMORY_LIMIT = 8;

export interface BuildTaskContextPackOptions {
  cwd: string;
  database: RunsteadDatabase;
  goal: Goal;
  task: Task;
  limit?: number;
  now?: Date;
}

export interface TaskContextPack {
  retrievalId: string;
  scopes: string[];
  memories: MemoryRecord[];
  event: RunsteadEvent;
}

export function buildTaskContextPack(
  options: BuildTaskContextPackOptions
): TaskContextPack {
  const limit = contextMemoryLimit(options.limit);
  const scopes = taskContextMemoryScopes(options);
  const memories = selectContextMemories({
    database: options.database,
    scopes,
    limit,
    now: options.now ?? new Date()
  });
  const retrievalId = createRunsteadId("retr");
  const createdAt = (options.now ?? new Date()).toISOString();
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "memory.context_pack_built",
    aggregateType: "memory_retrieval",
    aggregateId: retrievalId,
    payload: {
      retrievalId,
      taskId: options.task.id,
      goalId: options.goal.id,
      repositoryPath: options.cwd,
      scopes,
      limit,
      resultCount: memories.length,
      resultIds: memories.map((memory) => memory.id)
    },
    createdAt
  };

  appendEventAndProject(options.database, { event });

  return {
    retrievalId,
    scopes,
    memories,
    event
  };
}

export function formatTaskContextPackPrompt(
  pack: TaskContextPack | undefined
): string[] {
  if (pack === undefined || pack.memories.length === 0) {
    return [];
  }

  return [
    "Runstead verified memory context:",
    ...pack.memories.map(
      (memory) =>
        `- ${memory.id} ${memory.type} ${memory.scope} confidence=${memory.confidence}: ${memory.content} (sources: ${memory.sourceRefs.join(", ") || "none"})`
    ),
    `Memory retrieval audit: ${pack.retrievalId}`,
    ""
  ];
}

function selectContextMemories(input: {
  database: RunsteadDatabase;
  scopes: string[];
  limit: number;
  now: Date;
}): MemoryRecord[] {
  const scoped = input.scopes.flatMap((scope) =>
    readMemoryRecords(input.database, {
      status: "verified",
      scope
    })
  );
  const byId = new Map<string, MemoryRecord>();

  for (const memory of scoped) {
    if (!memoryExpired(memory, input.now)) {
      byId.set(memory.id, memory);
    }
  }

  return filterConflictedMemories([...byId.values()]).slice(0, input.limit);
}

function taskContextMemoryScopes(options: BuildTaskContextPackOptions): string[] {
  const repositoryPath = canonicalContextPath(options.cwd);
  const repository =
    findRepositoryByLocalPath(options.database, options.cwd) ??
    findRepositoryByLocalPath(options.database, repositoryPath);
  const taskType = options.task.type.trim();

  return [
    `repo:${options.cwd}`,
    ...(repositoryPath === options.cwd ? [] : [`repo:${repositoryPath}`]),
    ...(repository === undefined ? [] : [`repo:${repository.alias}`]),
    `repo:${basename(options.cwd)}`,
    `domain:${options.task.domain}`,
    ...(taskType.length === 0 ? [] : [`task_type:${taskType}`]),
    "global"
  ].filter(uniqueStrings);
}

function canonicalContextPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function filterConflictedMemories(memories: MemoryRecord[]): MemoryRecord[] {
  const conflicted = new Set<string>();

  for (const memory of memories) {
    if (memory.conflictsWith.length > 0) {
      conflicted.add(memory.id);
    }

    for (const conflictId of memory.conflictsWith) {
      conflicted.add(conflictId);
    }
  }

  return memories.filter((memory) => !conflicted.has(memory.id));
}

function memoryExpired(memory: MemoryRecord, now: Date): boolean {
  if (memory.expiresAt === undefined) {
    return false;
  }

  const expiresAt = Date.parse(memory.expiresAt);

  return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}

function contextMemoryLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_CONTEXT_MEMORY_LIMIT;

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Task context memory limit must be a positive integer");
  }

  return value;
}

function uniqueStrings(value: string, index: number, values: string[]): boolean {
  return values.indexOf(value) === index;
}
