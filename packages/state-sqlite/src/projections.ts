import type {
  ApprovalRequest,
  Evidence,
  Goal,
  MemoryRecord,
  PolicyDecisionRecord,
  RepositoryRecord,
  RunsteadEvent,
  Task,
  ToolCall,
  WorkerRun
} from "@runstead/core";
import {
  ApprovalRequestSchema,
  EvidenceSchema,
  GoalSchema,
  MemoryRecordSchema,
  PolicyDecisionRecordSchema,
  RepositoryRecordSchema,
  RunsteadEventSchema,
  TaskSchema,
  ToolCallSchema,
  WorkerRunSchema
} from "@runstead/core";

import type { RunsteadDatabase } from "./index.js";

export type StateProjection =
  | { type: "goal"; value: Goal }
  | { type: "task"; value: Task }
  | { type: "evidence"; value: Evidence }
  | { type: "policyDecision"; value: PolicyDecisionRecord }
  | { type: "approval"; value: ApprovalRequest }
  | { type: "workerRun"; value: WorkerRun }
  | { type: "toolCall"; value: ToolCall }
  | { type: "memory"; value: MemoryRecord }
  | { type: "repository"; value: RepositoryRecord };

export interface AppendEventAndProjectInput {
  event: RunsteadEvent;
  projection?: StateProjection;
}

export function appendEventAndProject(
  database: RunsteadDatabase,
  input: AppendEventAndProjectInput
): void {
  appendEventsAndProjects(database, [input]);
}

export function appendEventsAndProjects(
  database: RunsteadDatabase,
  inputs: AppendEventAndProjectInput[]
): void {
  const entries = inputs.map((input) => ({
    event: RunsteadEventSchema.parse(input.event),
    projection: input.projection
  }));

  database.exec("BEGIN IMMEDIATE");

  try {
    for (const entry of entries) {
      insertEvent(database, entry.event);

      if (entry.projection !== undefined) {
        upsertProjection(database, entry.projection);
      }
    }

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function insertEvent(database: RunsteadDatabase, event: RunsteadEvent): void {
  database
    .prepare(
      `
      INSERT INTO events (
        event_id,
        type,
        aggregate_type,
        aggregate_id,
        payload_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      event.eventId,
      event.type,
      event.aggregateType,
      event.aggregateId,
      JSON.stringify(event.payload),
      event.createdAt
    );
}

function upsertProjection(
  database: RunsteadDatabase,
  projection: StateProjection
): void {
  switch (projection.type) {
    case "goal":
      upsertGoal(database, GoalSchema.parse(projection.value));
      return;
    case "task":
      upsertTask(database, TaskSchema.parse(projection.value));
      return;
    case "evidence":
      upsertEvidence(database, EvidenceSchema.parse(projection.value));
      return;
    case "policyDecision":
      upsertPolicyDecision(
        database,
        PolicyDecisionRecordSchema.parse(projection.value)
      );
      return;
    case "approval":
      upsertApproval(database, ApprovalRequestSchema.parse(projection.value));
      return;
    case "workerRun":
      upsertWorkerRun(database, WorkerRunSchema.parse(projection.value));
      return;
    case "toolCall":
      upsertToolCall(database, ToolCallSchema.parse(projection.value));
      return;
    case "memory":
      upsertMemoryRecord(database, MemoryRecordSchema.parse(projection.value));
      return;
    case "repository":
      upsertRepository(database, RepositoryRecordSchema.parse(projection.value));
      return;
  }
}

function upsertGoal(database: RunsteadDatabase, goal: Goal): void {
  database
    .prepare(
      `
      INSERT INTO goals (
        id,
        domain,
        title,
        status,
        priority,
        scope_json,
        budget_json,
        policy_ref,
        acceptance_ref,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        domain = excluded.domain,
        title = excluded.title,
        status = excluded.status,
        priority = excluded.priority,
        scope_json = excluded.scope_json,
        budget_json = excluded.budget_json,
        policy_ref = excluded.policy_ref,
        acceptance_ref = excluded.acceptance_ref,
        updated_at = excluded.updated_at
    `
    )
    .run(
      goal.id,
      goal.domain,
      goal.title,
      goal.status,
      goal.priority,
      JSON.stringify(goal.scope),
      optionalJson(goal.budget),
      goal.policyRef ?? null,
      goal.acceptanceRef ?? null,
      goal.createdAt,
      goal.updatedAt
    );
}

function upsertTask(database: RunsteadDatabase, task: Task): void {
  database
    .prepare(
      `
      INSERT INTO tasks (
        id,
        goal_id,
        domain,
        type,
        status,
        priority,
        attempt,
        max_attempts,
        input_json,
        output_json,
        verifiers_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        goal_id = excluded.goal_id,
        domain = excluded.domain,
        type = excluded.type,
        status = excluded.status,
        priority = excluded.priority,
        attempt = excluded.attempt,
        max_attempts = excluded.max_attempts,
        input_json = excluded.input_json,
        output_json = excluded.output_json,
        verifiers_json = excluded.verifiers_json,
        updated_at = excluded.updated_at
    `
    )
    .run(
      task.id,
      task.goalId,
      task.domain,
      task.type,
      task.status,
      task.priority,
      task.attempt,
      task.maxAttempts,
      JSON.stringify(task.input),
      optionalJson(task.output),
      JSON.stringify(task.verifiers),
      task.createdAt,
      task.updatedAt
    );
}

function upsertEvidence(database: RunsteadDatabase, evidence: Evidence): void {
  database
    .prepare(
      `
      INSERT INTO evidence (
        id,
        type,
        subject_type,
        subject_id,
        uri,
        hash,
        summary,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        subject_type = excluded.subject_type,
        subject_id = excluded.subject_id,
        uri = excluded.uri,
        hash = excluded.hash,
        summary = excluded.summary,
        created_at = excluded.created_at
    `
    )
    .run(
      evidence.id,
      evidence.type,
      evidence.subjectType,
      evidence.subjectId,
      evidence.uri,
      evidence.hash ?? null,
      evidence.summary ?? null,
      evidence.createdAt
    );
}

function upsertPolicyDecision(
  database: RunsteadDatabase,
  decision: PolicyDecisionRecord
): void {
  database
    .prepare(
      `
      INSERT INTO policy_decisions (
        id,
        action_id,
        policy_id,
        decision,
        risk,
        rule_id,
        reason,
        obligations_json,
        action_json,
        result_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        action_id = excluded.action_id,
        policy_id = excluded.policy_id,
        decision = excluded.decision,
        risk = excluded.risk,
        rule_id = excluded.rule_id,
        reason = excluded.reason,
        obligations_json = excluded.obligations_json,
        action_json = excluded.action_json,
        result_json = excluded.result_json,
        created_at = excluded.created_at
    `
    )
    .run(
      decision.id,
      decision.actionId,
      decision.policyId,
      decision.decision,
      decision.risk,
      decision.ruleId ?? null,
      decision.reason,
      JSON.stringify(decision.obligations),
      JSON.stringify(decision.action),
      JSON.stringify(decision.result),
      decision.createdAt
    );
}

function upsertApproval(database: RunsteadDatabase, approval: ApprovalRequest): void {
  database
    .prepare(
      `
      INSERT INTO approvals (
        id,
        policy_decision_id,
        action_id,
        status,
        risk,
        reason,
        requested_by,
        expires_at,
        decided_at,
        decided_by,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        policy_decision_id = excluded.policy_decision_id,
        action_id = excluded.action_id,
        status = excluded.status,
        risk = excluded.risk,
        reason = excluded.reason,
        requested_by = excluded.requested_by,
        expires_at = excluded.expires_at,
        decided_at = excluded.decided_at,
        decided_by = excluded.decided_by,
        updated_at = excluded.updated_at
    `
    )
    .run(
      approval.id,
      approval.policyDecisionId,
      approval.actionId,
      approval.status,
      approval.risk,
      approval.reason,
      approval.requestedBy ?? null,
      approval.expiresAt ?? null,
      approval.decidedAt ?? null,
      approval.decidedBy ?? null,
      approval.createdAt,
      approval.updatedAt
    );
}

function upsertWorkerRun(database: RunsteadDatabase, workerRun: WorkerRun): void {
  database
    .prepare(
      `
      INSERT INTO worker_runs (
        id,
        task_id,
        worker_type,
        status,
        enforcement_level,
        checkpoint_before,
        started_at,
        ended_at,
        output_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        task_id = excluded.task_id,
        worker_type = excluded.worker_type,
        status = excluded.status,
        enforcement_level = excluded.enforcement_level,
        checkpoint_before = excluded.checkpoint_before,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        output_json = excluded.output_json
    `
    )
    .run(
      workerRun.id,
      workerRun.taskId,
      workerRun.workerType,
      workerRun.status,
      workerRun.enforcementLevel,
      workerRun.checkpointBefore ?? null,
      workerRun.startedAt,
      workerRun.endedAt ?? null,
      optionalJson(workerRun.output)
    );
}

function upsertToolCall(database: RunsteadDatabase, toolCall: ToolCall): void {
  database
    .prepare(
      `
      INSERT INTO tool_calls (
        id,
        worker_run_id,
        task_id,
        action_type,
        status,
        policy_decision_id,
        input_json,
        output_json,
        started_at,
        ended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        worker_run_id = excluded.worker_run_id,
        task_id = excluded.task_id,
        action_type = excluded.action_type,
        status = excluded.status,
        policy_decision_id = excluded.policy_decision_id,
        input_json = excluded.input_json,
        output_json = excluded.output_json,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at
    `
    )
    .run(
      toolCall.id,
      toolCall.workerRunId,
      toolCall.taskId,
      toolCall.actionType,
      toolCall.status,
      toolCall.policyDecisionId ?? null,
      JSON.stringify(toolCall.input),
      optionalJson(toolCall.output),
      toolCall.startedAt,
      toolCall.endedAt ?? null
    );
}

function upsertMemoryRecord(database: RunsteadDatabase, memory: MemoryRecord): void {
  database
    .prepare(
      `
      INSERT INTO memory_records (
        id,
        scope,
        type,
        status,
        confidence,
        content,
        source_refs_json,
        provenance_json,
        created_at,
        updated_at,
        expires_at,
        conflicts_with_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        scope = excluded.scope,
        type = excluded.type,
        status = excluded.status,
        confidence = excluded.confidence,
        content = excluded.content,
        source_refs_json = excluded.source_refs_json,
        provenance_json = excluded.provenance_json,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at,
        conflicts_with_json = excluded.conflicts_with_json
    `
    )
    .run(
      memory.id,
      memory.scope,
      memory.type,
      memory.status,
      memory.confidence,
      memory.content,
      JSON.stringify(memory.sourceRefs),
      JSON.stringify(memory.provenance),
      memory.createdAt,
      memory.updatedAt,
      memory.expiresAt ?? null,
      JSON.stringify(memory.conflictsWith)
    );
}

function upsertRepository(
  database: RunsteadDatabase,
  repository: RepositoryRecord
): void {
  database
    .prepare(
      `
      INSERT INTO repositories (
        id,
        alias,
        local_path,
        remote_url,
        default_branch,
        status,
        tags_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        alias = excluded.alias,
        local_path = excluded.local_path,
        remote_url = excluded.remote_url,
        default_branch = excluded.default_branch,
        status = excluded.status,
        tags_json = excluded.tags_json,
        updated_at = excluded.updated_at
    `
    )
    .run(
      repository.id,
      repository.alias,
      repository.localPath,
      repository.remoteUrl ?? null,
      repository.defaultBranch ?? null,
      repository.status,
      JSON.stringify(repository.tags),
      repository.createdAt,
      repository.updatedAt
    );
}

function optionalJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}
