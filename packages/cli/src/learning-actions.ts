import { join, resolve } from "node:path";

import {
  createRunsteadId,
  type JsonObject,
  type MemoryRecord,
  type RunsteadEvent
} from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import type { CreateSkillCandidateResult } from "@runstead/skills";
import { createSkillCandidatePackage } from "@runstead/skills";

import { showGoal } from "./goals.js";
import {
  reviewLocalAgentLearning,
  type ReviewLocalAgentLearningResult
} from "./learning-review.js";
import { memoryEventPayload } from "./memory-record-builders.js";
import { readMemoryRecord } from "./memory-query.js";
import { requireRunsteadStateDbSync } from "./runstead-root.js";
import { showTask } from "./tasks.js";

export interface ReviewLearningForTaskOptions {
  cwd?: string;
  taskId: string;
  now?: Date;
}

export interface ReviewLearningForTaskResult {
  review: ReviewLocalAgentLearningResult;
  stateDb: string;
}

export interface PromoteLearningMemoryCandidateOptions {
  cwd?: string;
  candidateId: string;
  promotedBy?: string;
  now?: Date;
}

export interface PromoteLearningMemoryCandidateResult {
  memory: MemoryRecord;
  event: RunsteadEvent;
  previousStatus: MemoryRecord["status"];
  stateDb: string;
}

export interface CreateSkillFromLearningCandidateOptions {
  cwd?: string;
  candidateId: string;
  name?: string;
  dir?: string;
  domain?: string;
  triggers?: string[];
  allowedTools?: string[];
  deniedTools?: string[];
  verifierCommands?: string[];
  author?: string;
  scopeRepos?: string[];
  now?: Date;
}

export interface CreateSkillFromLearningCandidateResult {
  memory: MemoryRecord;
  skill: CreateSkillCandidateResult;
  event: RunsteadEvent;
  stateDb: string;
}

export function reviewLearningForTask(
  options: ReviewLearningForTaskOptions
): ReviewLearningForTaskResult {
  const cwd = resolve(options.cwd ?? process.cwd());
  const task = showTask({ cwd, id: options.taskId }).task;
  const goal = showGoal({ cwd, id: task.goalId }).goal;
  const stateDb = requireRunsteadStateDbSync(cwd).stateDb;
  const database = openRunsteadDatabase(stateDb);

  try {
    return {
      review: reviewLocalAgentLearning({
        cwd,
        database,
        goal,
        task,
        finalTask: task,
        ...(options.now === undefined ? {} : { now: options.now })
      }),
      stateDb
    };
  } finally {
    database.close();
  }
}

export function promoteLearningMemoryCandidate(
  options: PromoteLearningMemoryCandidateOptions
): PromoteLearningMemoryCandidateResult {
  const cwd = resolve(options.cwd ?? process.cwd());
  const stateDb = requireRunsteadStateDbSync(cwd).stateDb;
  const database = openRunsteadDatabase(stateDb);

  try {
    const current = requireMemoryCandidate(database, options.candidateId);

    if (current.status !== "quarantined") {
      throw new Error(
        `Learning memory candidate ${options.candidateId} is not quarantined: ${current.status}`
      );
    }

    const promotedAt = (options.now ?? new Date()).toISOString();
    const memory: MemoryRecord = {
      ...current,
      status: "verified",
      confidence: Math.max(current.confidence, 0.9),
      updatedAt: promotedAt,
      provenance: {
        ...current.provenance,
        promotedBy: options.promotedBy ?? "local-admin",
        promotedAt
      }
    };
    const event: RunsteadEvent = {
      eventId: createRunsteadId("evt"),
      type: "memory.candidate_promoted",
      aggregateType: "memory",
      aggregateId: memory.id,
      payload: memoryEventPayload(memory),
      createdAt: promotedAt
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
      previousStatus: current.status,
      stateDb
    };
  } finally {
    database.close();
  }
}

export async function createSkillFromLearningCandidate(
  options: CreateSkillFromLearningCandidateOptions
): Promise<CreateSkillFromLearningCandidateResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const stateDb = requireRunsteadStateDbSync(cwd).stateDb;
  const database = openRunsteadDatabase(stateDb);

  try {
    const memory = requireMemoryCandidate(database, options.candidateId);

    if (memory.type !== "skill_candidate") {
      throw new Error(
        `Learning memory candidate ${options.candidateId} is not a skill_candidate: ${memory.type}`
      );
    }

    const suggested = suggestedSkill(memory);
    const name =
      options.name ?? stringValue(suggested, "name") ?? fallbackSkillName(memory);
    const root = options.dir ?? join(cwd, "skills", name);
    const skill = await createSkillCandidatePackage({
      root,
      name,
      domain: options.domain ?? stringValue(suggested, "domain") ?? "repo-maintenance",
      description: memory.content,
      triggers: firstNonEmpty(options.triggers, stringArray(suggested, "triggers"), [
        memory.content
      ]),
      allowedTools: firstNonEmpty(
        options.allowedTools,
        stringArray(suggested, "allowedTools"),
        ["workspace.read", "workspace.write", "verifier.run"]
      ),
      deniedTools: firstNonEmpty(
        options.deniedTools,
        stringArray(suggested, "deniedTools"),
        ["secret.read", "external.write"]
      ),
      verifierCommands: firstNonEmpty(
        options.verifierCommands,
        stringArray(suggested, "verifierCommands"),
        ["pnpm test"]
      ),
      provenanceTasks: firstNonEmpty(
        stringArray(memory.provenance, "createdFromTask"),
        [stringValue(memory.provenance, "createdFromTask")].filter(
          (value): value is string => value !== undefined
        ),
        [memory.id]
      ),
      ...(options.scopeRepos === undefined || options.scopeRepos.length === 0
        ? {}
        : { scopeRepos: options.scopeRepos }),
      ...(options.author === undefined ? {} : { author: options.author })
    });
    const createdAt = (options.now ?? new Date()).toISOString();
    const event: RunsteadEvent = {
      eventId: createRunsteadId("evt"),
      type: "learning.skill_candidate_created",
      aggregateType: "memory",
      aggregateId: memory.id,
      payload: {
        memoryId: memory.id,
        skillRoot: skill.root,
        skillName: name
      },
      createdAt
    };

    appendEventAndProject(database, { event });

    return {
      memory,
      skill,
      event,
      stateDb
    };
  } finally {
    database.close();
  }
}

function requireMemoryCandidate(
  database: ReturnType<typeof openRunsteadDatabase>,
  id: string
): MemoryRecord {
  const memory = readMemoryRecord(database, id);

  if (memory === undefined) {
    throw new Error(`Learning memory candidate not found: ${id}`);
  }

  return memory;
}

function suggestedSkill(memory: MemoryRecord): JsonObject {
  const proposal = objectValue(memory.provenance.proposal);

  return objectValue(proposal.suggestedSkill);
}

function fallbackSkillName(memory: MemoryRecord): string {
  return `learning-${memory.id}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function firstNonEmpty<T>(...candidates: (T[] | undefined)[]): T[] {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate.length > 0) {
      return candidate;
    }
  }

  return [];
}

function stringValue(value: JsonObject, key: string): string | undefined {
  const field = value[key];

  return typeof field === "string" && field.trim().length > 0
    ? field.trim()
    : undefined;
}

function stringArray(value: JsonObject, key: string): string[] {
  const field = value[key];

  if (typeof field === "string" && field.trim().length > 0) {
    return [field.trim()];
  }

  return Array.isArray(field)
    ? field.filter((item): item is string => typeof item === "string")
    : [];
}

function objectValue(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}
