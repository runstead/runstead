import { resolve } from "node:path";

import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import {
  filterConflictedProjectFacts,
  filterExpiredProjectFacts,
  matchesFactQuery,
  normalizedQuery,
  readProjectFacts
} from "./memory-query.js";
import type {
  ListProjectFactsOptions,
  ListProjectFactsResult,
  RetrieveProjectFactsOptions,
  RetrieveProjectFactsResult
} from "./memory-types.js";
import { requireRunsteadStateDbSync } from "./runstead-root.js";

export { quarantineMemoryCandidate, recordProjectFact } from "./memory-writes.js";
export type {
  ListProjectFactsOptions,
  ListProjectFactsResult,
  QuarantineMemoryCandidateOptions,
  QuarantineMemoryCandidateResult,
  RecordProjectFactOptions,
  RecordProjectFactResult,
  RetrieveProjectFactsOptions,
  RetrieveProjectFactsResult
} from "./memory-types.js";

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
