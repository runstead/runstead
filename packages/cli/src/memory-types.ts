import type { MemoryRecord, RunsteadEvent } from "@runstead/core";

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
