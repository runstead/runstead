import { join, resolve } from "node:path";

import {
  createRunsteadId,
  type JsonObject,
  type MemoryRecord,
  type RunsteadEvent
} from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import type { CreateSkillCandidateResult } from "@runstead/skills";
import { createSkillCandidatePackage, promoteSkillPackage } from "@runstead/skills";

import { showGoal } from "./goals.js";
import {
  reviewLocalAgentLearning,
  type ReviewLocalAgentLearningResult
} from "./learning-review.js";
import { memoryEventPayload } from "./memory-record-builders.js";
import { readMemoryRecord, readMemoryRecords } from "./memory-query.js";
import {
  requireRunsteadRootSync,
  requireRunsteadStateDbSync
} from "./runstead-root.js";
import {
  activateSkillPackage,
  type SkillActivationRecord,
  type SkillActivationRisk,
  type SkillActivationStatus
} from "./skill-activations.js";
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

export type AutoImproveLearningScope = "repo" | "global";

export interface AutoImproveLearningOptions {
  cwd?: string;
  scope?: AutoImproveLearningScope;
  risk?: SkillActivationRisk;
  limit?: number;
  canaryPercent?: number;
  activationStatus?: SkillActivationStatus;
  rollbackOnRegression?: boolean;
  promotedBy?: string;
  now?: Date;
}

export interface AutoImproveLearningResult {
  stateDb: string;
  decisions: AutoImproveLearningDecision[];
}

export type AutoImproveLearningDecision =
  | {
      candidateId: string;
      status: "promoted";
      skillRoot: string;
      activation: SkillActivationRecord;
    }
  | {
      candidateId: string;
      status: "skipped";
      reason: string;
    };

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

export async function autoImproveLearning(
  options: AutoImproveLearningOptions = {}
): Promise<AutoImproveLearningResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const root = requireRunsteadRootSync(cwd).root;
  const stateDb = requireRunsteadStateDbSync(cwd).stateDb;
  const decisions: AutoImproveLearningDecision[] = [];
  const candidates = quarantinedSkillCandidates({
    stateDb,
    ...(options.limit === undefined ? {} : { limit: options.limit })
  });

  for (const candidate of candidates) {
    const eligibility = autoImproveEligibility(candidate, {
      cwd,
      scope: options.scope ?? "repo",
      risk: options.risk ?? "low"
    });

    if (eligibility !== "eligible") {
      decisions.push({
        candidateId: candidate.id,
        status: "skipped",
        reason: eligibility
      });
      continue;
    }

    try {
      const skillName = autoImproveSkillName(candidate);
      const skillResult = await createSkillFromLearningCandidate({
        cwd,
        candidateId: candidate.id,
        name: skillName,
        dir: join(cwd, "skills", skillName),
        scopeRepos: options.scope === "global" ? [] : [cwd],
        author: options.promotedBy ?? "runstead:auto-improve",
        ...(options.now === undefined ? {} : { now: options.now })
      });
      await promoteSkillPackage({
        root: skillResult.skill.root,
        promotedBy: options.promotedBy ?? "runstead:auto-improve",
        ...(options.now === undefined ? {} : { now: options.now })
      });
      const database = openRunsteadDatabase(stateDb);
      let activation: SkillActivationRecord;

      try {
        activation = activateSkillPackage({
          root,
          database,
          skillRoot: skillResult.skill.root,
          status: options.activationStatus ?? "active",
          risk: options.risk ?? "low",
          canaryPercent: options.canaryPercent ?? 100,
          rollbackOnRegression: options.rollbackOnRegression ?? true,
          activatedBy: options.promotedBy ?? "runstead:auto-improve",
          sourceMemoryId: candidate.id,
          scopeRepos: options.scope === "global" ? [] : [cwd],
          taskTypes: ["local_agent_task"],
          ...(options.now === undefined ? {} : { now: options.now })
        });
      } finally {
        database.close();
      }

      promoteLearningMemoryCandidate({
        cwd,
        candidateId: candidate.id,
        promotedBy: options.promotedBy ?? "runstead:auto-improve",
        ...(options.now === undefined ? {} : { now: options.now })
      });
      decisions.push({
        candidateId: candidate.id,
        status: "promoted",
        skillRoot: skillResult.skill.root,
        activation
      });
    } catch (error) {
      decisions.push({
        candidateId: candidate.id,
        status: "skipped",
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    stateDb,
    decisions
  };
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

function quarantinedSkillCandidates(input: {
  stateDb: string;
  limit?: number;
}): MemoryRecord[] {
  const database = openRunsteadDatabase(input.stateDb);

  try {
    return readMemoryRecords(database, {
      status: "quarantined",
      type: "skill_candidate",
      ...(input.limit === undefined ? {} : { limit: input.limit })
    });
  } finally {
    database.close();
  }
}

function autoImproveEligibility(
  memory: MemoryRecord,
  options: {
    cwd: string;
    scope: AutoImproveLearningScope;
    risk: SkillActivationRisk;
  }
): string {
  const proposal = objectValue(memory.provenance.proposal);
  const suggested = suggestedSkill(memory);

  if (proposal.suggestedPromotionAction !== "create-skill") {
    return "candidate does not request skill creation";
  }

  if (proposal.requiredVerifier !== "skill_test") {
    return "candidate does not require skill_test verification";
  }

  if (options.risk === "low" && memory.confidence < 0.5) {
    return "low-risk auto-improvement requires confidence >= 0.5";
  }

  if (options.scope === "global" && options.risk === "low") {
    return "global auto-improvement requires --risk medium or --risk high";
  }

  if (options.scope === "repo" && memory.scope !== `repo:${options.cwd}`) {
    return `repo-scoped auto-improvement requires scope repo:${options.cwd}`;
  }

  const allowedTools = stringArray(suggested, "allowedTools");
  const deniedTools = stringArray(suggested, "deniedTools");

  if (allowedTools.some(isHighImpactTool)) {
    return "candidate allows high-impact tools";
  }

  if (!deniedTools.includes("secret.read") || !deniedTools.includes("external.write")) {
    return "candidate must deny secret.read and external.write";
  }

  return "eligible";
}

function autoImproveSkillName(memory: MemoryRecord): string {
  const suggested = suggestedSkill(memory);
  const base = stringValue(suggested, "name") ?? fallbackSkillName(memory);
  const suffix = memory.id
    .toLowerCase()
    .replace(/^mem_/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 8);

  return `${base}-${suffix}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isHighImpactTool(tool: string): boolean {
  return [
    "secret.read",
    "external.write",
    "policy.write",
    "auth.write",
    "deployment.write",
    "package.install",
    "package.update",
    "git.push",
    "github.pr.create"
  ].includes(tool);
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
