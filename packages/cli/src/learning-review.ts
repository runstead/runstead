import { createHash } from "node:crypto";
import { basename } from "node:path";

import {
  createRunsteadId,
  MemoryRecordSchema,
  MemoryTypeSchema,
  type Goal,
  type JsonObject,
  type MemoryRecord,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import { appendEventsAndProjects, type RunsteadDatabase } from "@runstead/state-sqlite";

import type { LocalAgentWorkerResult } from "./local-agent-result.js";
import {
  isCodexDirectLocalAgentWorkerResult,
  localAgentFinalSummary
} from "./local-agent-result.js";
import {
  localAgentTaskMode,
  verifierCommandsFromLocalAgentTask
} from "./local-agent-task-input.js";
import {
  memoryEventPayload,
  memoryProvenance,
  quarantinedMemoryConfidence
} from "./memory-record-builders.js";
import type { RunTaskVerifiersResult } from "./verifier-runner.js";

export type LearningCandidateType =
  | "project_fact"
  | "user_preference"
  | "tooling_observation"
  | "policy_lesson"
  | "skill_candidate";

export interface LearningCandidateProposal {
  candidateKey: string;
  type: LearningCandidateType;
  scope: string;
  content: string;
  confidence: number;
  sourceRefs: string[];
  proposal: JsonObject;
}

export interface ReviewLocalAgentLearningOptions {
  cwd: string;
  database: RunsteadDatabase;
  goal: Goal;
  task: Task;
  finalTask: Task;
  workerResult?: LocalAgentWorkerResult;
  verifierResult?: RunTaskVerifiersResult;
  now?: Date;
}

export interface ReviewLocalAgentLearningResult {
  event: RunsteadEvent;
  candidates: LearningCandidateProposal[];
  quarantinedMemories: MemoryRecord[];
}

interface LearningAuditRows {
  workerRuns: WorkerRunLearningRow[];
  toolCalls: ToolCallLearningRow[];
  policyDecisions: PolicyDecisionLearningRow[];
  approvals: ApprovalLearningRow[];
  evidence: EvidenceLearningRow[];
}

interface WorkerRunLearningRow {
  id: string;
  worker_type: string;
  status: string;
}

interface ToolCallLearningRow {
  id: string;
  action_type: string;
  status: string;
  policy_decision_id: string | null;
}

interface PolicyDecisionLearningRow {
  id: string;
  decision: string;
  risk: string;
  rule_id: string | null;
  reason: string;
}

interface ApprovalLearningRow {
  id: string;
  status: string;
  risk: string;
  reason: string;
}

interface EvidenceLearningRow {
  id: string;
  type: string;
  summary: string | null;
}

export function reviewLocalAgentLearning(
  options: ReviewLocalAgentLearningOptions
): ReviewLocalAgentLearningResult {
  const reviewedAt = (options.now ?? new Date()).toISOString();
  const audit = readLearningAuditRows(options.database, options.finalTask.id);
  const candidates = learningCandidatesForLocalAgentRun({
    ...options,
    audit
  });
  const quarantined = candidates.map((candidate) =>
    quarantinedLearningMemory({
      candidate,
      taskId: options.finalTask.id,
      createdAt: reviewedAt
    })
  );
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "learning.review_completed",
    aggregateType: "task",
    aggregateId: options.finalTask.id,
    payload: {
      taskId: options.finalTask.id,
      goalId: options.goal.id,
      repositoryPath: options.cwd,
      candidateCount: candidates.length,
      quarantinedMemoryIds: quarantined.map((candidate) => candidate.memory.id),
      candidates: candidates.map((candidate, index) => ({
        candidateKey: candidate.candidateKey,
        memoryId: quarantined[index]?.memory.id ?? null,
        type: candidate.type,
        scope: candidate.scope,
        confidence: candidate.confidence,
        sourceRefs: candidate.sourceRefs,
        proposal: candidate.proposal
      }))
    },
    createdAt: reviewedAt
  };

  appendEventsAndProjects(options.database, [
    ...quarantined.map((candidate) => ({
      event: candidate.event,
      projection: {
        type: "memory" as const,
        value: candidate.memory
      }
    })),
    { event }
  ]);

  return {
    event,
    candidates,
    quarantinedMemories: quarantined.map((candidate) => candidate.memory)
  };
}

function learningCandidatesForLocalAgentRun(
  options: ReviewLocalAgentLearningOptions & { audit: LearningAuditRows }
): LearningCandidateProposal[] {
  const candidates: LearningCandidateProposal[] = [];
  const sourceRefs = learningSourceRefs(options.finalTask.id, options.audit);
  const summary = learningSummary(options);
  const prompt = taskPrompt(options.task);
  const verifierCommands = verifierCommandsFromLocalAgentTask(options.task);
  const workerType = learningWorkerType(options);
  const status = options.finalTask.status;

  if (summary !== undefined && status === "completed") {
    candidates.push(
      learningCandidate({
        type: "project_fact",
        scope: repoScope(options.cwd),
        content: `Task ${options.finalTask.id} completed in ${basename(options.cwd)} with summary: ${summary}`,
        confidence: 0.62,
        sourceRefs,
        task: options.finalTask,
        proposal: {
          candidateClass: "memory_fact",
          proposedScope: repoScope(options.cwd),
          requiredVerifier: "human_review",
          suggestedPromotionAction: "promote-memory",
          sourceRunIds: options.audit.workerRuns.map((run) => run.id)
        }
      })
    );
  }

  const preferenceCue = userPreferenceCue(prompt);

  if (preferenceCue !== undefined) {
    candidates.push(
      learningCandidate({
        type: "user_preference",
        scope: "user:local",
        content: `User preference candidate from task prompt: ${preferenceCue}`,
        confidence: 0.55,
        sourceRefs: [`task:${options.task.id}`],
        task: options.finalTask,
        proposal: {
          candidateClass: "preference",
          proposedScope: "user:local",
          requiredVerifier: "human_review",
          suggestedPromotionAction: "promote-memory",
          sourceRunIds: options.audit.workerRuns.map((run) => run.id)
        }
      })
    );
  }

  if (options.audit.toolCalls.length > 0 || verifierCommands.length > 0) {
    candidates.push(
      learningCandidate({
        type: "tooling_observation",
        scope: repoScope(options.cwd),
        content: [
          `Local agent used ${workerType} for ${options.finalTask.id}.`,
          `Audited tool calls: ${options.audit.toolCalls.length}.`,
          `Configured verifiers: ${verifierCommands.map((command) => command.name).join(", ") || "none"}.`
        ].join(" "),
        confidence: 0.7,
        sourceRefs,
        task: options.finalTask,
        proposal: {
          candidateClass: "tooling_observation",
          proposedScope: repoScope(options.cwd),
          requiredVerifier: "task_audit_review",
          suggestedPromotionAction: "promote-memory",
          sourceRunIds: options.audit.workerRuns.map((run) => run.id),
          toolCallIds: options.audit.toolCalls.map((call) => call.id)
        }
      })
    );
  }

  if (options.audit.policyDecisions.length > 0 || options.audit.approvals.length > 0) {
    candidates.push(
      learningCandidate({
        type: "policy_lesson",
        scope: `policy:${options.task.domain}`,
        content: policyLessonContent(options.audit),
        confidence: 0.68,
        sourceRefs,
        task: options.finalTask,
        proposal: {
          candidateClass: "policy_lesson",
          proposedScope: `policy:${options.task.domain}`,
          requiredVerifier: "policy_review",
          suggestedPromotionAction: "promote-memory",
          sourceRunIds: options.audit.workerRuns.map((run) => run.id),
          policyDecisionIds: options.audit.policyDecisions.map(
            (decision) => decision.id
          ),
          approvalIds: options.audit.approvals.map((approval) => approval.id)
        }
      })
    );
  }

  if (status === "completed" && prompt.length > 0) {
    candidates.push(
      learningCandidate({
        type: "skill_candidate",
        scope: repoScope(options.cwd),
        content: `Reusable skill candidate for ${basename(options.cwd)} ${localAgentTaskMode(options.task)} tasks: ${promptSummary(prompt)}`,
        confidence: skillCandidateConfidence(options),
        sourceRefs,
        task: options.finalTask,
        proposal: {
          candidateClass: "skill_candidate",
          proposedScope: repoScope(options.cwd),
          requiredVerifier: "skill_test",
          suggestedPromotionAction: "create-skill",
          sourceRunIds: options.audit.workerRuns.map((run) => run.id),
          suggestedSkill: {
            name: suggestedSkillName(options.cwd, prompt),
            domain: options.task.domain,
            triggers: [promptSummary(prompt)],
            allowedTools: ["workspace.read", "workspace.write", "verifier.run"],
            deniedTools: ["secret.read", "external.write"],
            verifierCommands: verifierCommands.map((command) => command.command)
          }
        }
      })
    );
  }

  return candidates;
}

function learningCandidate(input: {
  type: LearningCandidateType;
  scope: string;
  content: string;
  confidence: number;
  sourceRefs: string[];
  task: Task;
  proposal: JsonObject;
}): LearningCandidateProposal {
  return {
    candidateKey: [
      "learning",
      input.task.id,
      input.type,
      createHash("sha256").update(input.content).digest("hex").slice(0, 12)
    ].join(":"),
    type: input.type,
    scope: input.scope,
    content: input.content,
    confidence: input.confidence,
    sourceRefs: [...new Set(input.sourceRefs)],
    proposal: input.proposal
  };
}

function quarantinedLearningMemory(input: {
  candidate: LearningCandidateProposal;
  taskId: string;
  createdAt: string;
}): { memory: MemoryRecord; event: RunsteadEvent } {
  const memory = MemoryRecordSchema.parse({
    id: createRunsteadId("mem"),
    scope: input.candidate.scope,
    type: MemoryTypeSchema.parse(input.candidate.type),
    status: "quarantined",
    confidence: quarantinedMemoryConfidence(input.candidate.confidence),
    content: input.candidate.content,
    sourceRefs: input.candidate.sourceRefs,
    provenance: memoryProvenance({
      createdBy: "runstead:learning-review",
      taskId: input.taskId,
      candidateKey: input.candidate.candidateKey,
      proposal: input.candidate.proposal
    }),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    conflictsWith: []
  });
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "memory.candidate_quarantined",
    aggregateType: "memory",
    aggregateId: memory.id,
    payload: memoryEventPayload(memory),
    createdAt: input.createdAt
  };

  return {
    memory,
    event
  };
}

function readLearningAuditRows(
  database: RunsteadDatabase,
  taskId: string
): LearningAuditRows {
  const workerRuns = database
    .prepare(
      `
      SELECT id, worker_type, status
      FROM worker_runs
      WHERE task_id = ?
      ORDER BY started_at ASC, id ASC
    `
    )
    .all(taskId) as unknown as WorkerRunLearningRow[];
  const toolCalls = database
    .prepare(
      `
      SELECT id, action_type, status, policy_decision_id
      FROM tool_calls
      WHERE task_id = ?
      ORDER BY started_at ASC, id ASC
    `
    )
    .all(taskId) as unknown as ToolCallLearningRow[];
  const policyDecisionIds = [
    ...new Set(
      toolCalls.flatMap((call) =>
        call.policy_decision_id === null ? [] : [call.policy_decision_id]
      )
    )
  ];
  const policyDecisions =
    policyDecisionIds.length === 0
      ? []
      : (database
          .prepare(
            `
            SELECT id, decision, risk, rule_id, reason
            FROM policy_decisions
            WHERE id IN (${policyDecisionIds.map(() => "?").join(", ")})
            ORDER BY created_at ASC, id ASC
          `
          )
          .all(...policyDecisionIds) as unknown as PolicyDecisionLearningRow[]);
  const approvals =
    policyDecisionIds.length === 0
      ? []
      : (database
          .prepare(
            `
            SELECT id, status, risk, reason
            FROM approvals
            WHERE policy_decision_id IN (${policyDecisionIds.map(() => "?").join(", ")})
            ORDER BY created_at ASC, id ASC
          `
          )
          .all(...policyDecisionIds) as unknown as ApprovalLearningRow[]);
  const evidence = database
    .prepare(
      `
      SELECT id, type, summary
      FROM evidence
      WHERE subject_type = 'task' AND subject_id = ?
      ORDER BY created_at ASC, id ASC
    `
    )
    .all(taskId) as unknown as EvidenceLearningRow[];

  return {
    workerRuns,
    toolCalls,
    policyDecisions,
    approvals,
    evidence
  };
}

function learningSourceRefs(taskId: string, audit: LearningAuditRows): string[] {
  return [
    `task:${taskId}`,
    ...audit.workerRuns.map((run) => `worker_run:${run.id}`),
    ...audit.toolCalls.map((call) => `tool_call:${call.id}`),
    ...audit.policyDecisions.map((decision) => `policy_decision:${decision.id}`),
    ...audit.approvals.map((approval) => `approval:${approval.id}`),
    ...audit.evidence.map((evidence) => `evidence:${evidence.id}`)
  ];
}

function learningSummary(options: ReviewLocalAgentLearningOptions): string | undefined {
  if (options.workerResult !== undefined) {
    return truncateSingleLine(
      localAgentFinalSummary(options.workerResult, options.verifierResult),
      240
    );
  }

  const outputSummary = options.finalTask.output?.summary;

  return typeof outputSummary === "string"
    ? truncateSingleLine(outputSummary, 240)
    : undefined;
}

function learningWorkerType(
  options: ReviewLocalAgentLearningOptions & { audit: LearningAuditRows }
): string {
  if (options.workerResult !== undefined) {
    return isCodexDirectLocalAgentWorkerResult(options.workerResult)
      ? options.workerResult.worker
      : options.workerResult.worker;
  }

  return options.audit.workerRuns.at(-1)?.worker_type ?? "unknown_worker";
}

function policyLessonContent(audit: LearningAuditRows): string {
  const decisions = countBy(audit.policyDecisions.map((decision) => decision.decision));
  const risks = countBy(audit.policyDecisions.map((decision) => decision.risk));
  const approvals = countBy(audit.approvals.map((approval) => approval.status));

  return [
    "Policy lesson candidate from local agent task audit.",
    `Decisions: ${formatCounts(decisions) || "none"}.`,
    `Risk levels: ${formatCounts(risks) || "none"}.`,
    `Approvals: ${formatCounts(approvals) || "none"}.`
  ].join(" ");
}

function skillCandidateConfidence(options: ReviewLocalAgentLearningOptions): number {
  if (options.workerResult === undefined) {
    return 0.5;
  }

  if (
    isCodexDirectLocalAgentWorkerResult(options.workerResult) &&
    options.workerResult.failedToolCalls === 0
  ) {
    return 0.58;
  }

  return 0.5;
}

function userPreferenceCue(prompt: string): string | undefined {
  return prompt
    .split(/[.!?\n]/)
    .map((sentence) => sentence.trim())
    .find((sentence) =>
      /\b(prefer|always|never|must|should|不要|必须|每个|一直|避免)\b/i.test(sentence)
    );
}

function taskPrompt(task: Task): string {
  const value = task.input.prompt;

  return typeof value === "string" ? value.trim() : "";
}

function promptSummary(prompt: string): string {
  return truncateSingleLine(prompt, 96);
}

function truncateSingleLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3)}...`;
}

function suggestedSkillName(cwd: string, prompt: string): string {
  const repo = basename(cwd)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const promptToken = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28)
    .replace(/-+$/g, "");
  const name = [repo || "workspace", promptToken || "local-agent-task"]
    .join("-")
    .replace(/-+/g, "-");

  return /^[a-z]/.test(name) ? name : `skill-${name}`;
}

function repoScope(cwd: string): string {
  return `repo:${cwd}`;
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
}

function formatCounts(counts: Map<string, number>): string {
  return [...counts.entries()].map(([key, value]) => `${key}=${value}`).join(", ");
}
