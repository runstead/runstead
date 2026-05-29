import { resolve } from "node:path";

import { MemoryTypeSchema, type JsonObject, type MemoryRecord } from "@runstead/core";
import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { readMemoryRecords } from "./memory-query.js";
import { requireRunsteadStateDbSync } from "./runstead-root.js";

export interface ListLearningProposalsOptions {
  cwd?: string;
  scope?: string;
  type?: string;
  limit?: number;
}

export interface ListLearningProposalsResult {
  proposals: LearningProposal[];
  stateDb: string;
}

export interface LearningProposal {
  id: string;
  candidateKey?: string;
  type: string;
  scope: string;
  confidence: number;
  content: string;
  sourceRefs: string[];
  proposedScope?: string;
  requiredVerifier?: string;
  suggestedPromotionAction?: string;
  sourceRunIds: string[];
  toolCallIds: string[];
  policyDecisionIds: string[];
  approvalIds: string[];
  createdFromTask?: string;
  createdAt: string;
}

export function listLearningProposals(
  options: ListLearningProposalsOptions = {}
): ListLearningProposalsResult {
  const cwd = resolve(options.cwd ?? process.cwd());
  const stateDb = requireRunsteadStateDbSync(cwd).stateDb;
  const database = openRunsteadDatabase(stateDb);
  const type =
    options.type === undefined ? undefined : MemoryTypeSchema.parse(options.type);
  const limit = proposalLimit(options.limit);

  try {
    return {
      proposals: readMemoryRecords(database, {
        status: "quarantined",
        ...(options.scope === undefined ? {} : { scope: options.scope }),
        ...(type === undefined ? {} : { type }),
        ...(limit === undefined ? {} : { limit })
      }).map(memoryToLearningProposal),
      stateDb
    };
  } finally {
    database.close();
  }
}

function proposalLimit(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Learning proposal limit must be a positive integer");
  }

  return value;
}

export function formatLearningProposals(proposals: LearningProposal[]): string {
  if (proposals.length === 0) {
    return "No learning proposals found.";
  }

  return proposals
    .map((proposal) =>
      [
        `${proposal.id} ${proposal.type} ${proposal.scope} confidence=${proposal.confidence}`,
        `  action: ${proposal.suggestedPromotionAction ?? "review"}`,
        `  verifier: ${proposal.requiredVerifier ?? "human_review"}`,
        `  proposed_scope: ${proposal.proposedScope ?? proposal.scope}`,
        ...(proposal.createdFromTask === undefined
          ? []
          : [`  task: ${proposal.createdFromTask}`]),
        ...(proposal.sourceRunIds.length === 0
          ? []
          : [`  source_runs: ${proposal.sourceRunIds.join(", ")}`]),
        ...(proposal.toolCallIds.length === 0
          ? []
          : [`  tool_calls: ${proposal.toolCallIds.join(", ")}`]),
        ...(proposal.policyDecisionIds.length === 0
          ? []
          : [`  policy_decisions: ${proposal.policyDecisionIds.join(", ")}`]),
        ...(proposal.approvalIds.length === 0
          ? []
          : [`  approvals: ${proposal.approvalIds.join(", ")}`]),
        `  sources: ${proposal.sourceRefs.join(", ") || "none"}`,
        `  content: ${proposal.content}`
      ].join("\n")
    )
    .join("\n\n");
}

function memoryToLearningProposal(memory: MemoryRecord): LearningProposal {
  const proposal = objectValue(memory.provenance.proposal);

  return {
    id: memory.id,
    ...stringField(memory.provenance, "candidateKey"),
    type: memory.type,
    scope: memory.scope,
    confidence: memory.confidence,
    content: memory.content,
    sourceRefs: memory.sourceRefs,
    ...stringField(proposal, "proposedScope"),
    ...stringField(proposal, "requiredVerifier"),
    ...stringField(proposal, "suggestedPromotionAction"),
    sourceRunIds: stringArrayField(proposal, "sourceRunIds"),
    toolCallIds: stringArrayField(proposal, "toolCallIds"),
    policyDecisionIds: stringArrayField(proposal, "policyDecisionIds"),
    approvalIds: stringArrayField(proposal, "approvalIds"),
    ...createdFromTask(memory.provenance),
    createdAt: memory.createdAt
  };
}

function stringField<T extends string>(
  value: JsonObject,
  key: T
): Partial<Record<T, string>> {
  const field = value[key];

  return typeof field === "string" && field.trim().length > 0
    ? ({ [key]: field } as Partial<Record<T, string>>)
    : {};
}

function stringArrayField(value: JsonObject, key: string): string[] {
  const field = value[key];

  return Array.isArray(field)
    ? field.filter((item): item is string => typeof item === "string")
    : [];
}

function objectValue(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function createdFromTask(value: JsonObject): { createdFromTask?: string } {
  const task = value.createdFromTask;

  return typeof task === "string" && task.trim().length > 0
    ? { createdFromTask: task }
    : {};
}
