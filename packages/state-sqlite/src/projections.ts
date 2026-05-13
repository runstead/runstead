import type { Evidence, Goal, RunsteadEvent, Task } from "@runstead/core";
import {
  EvidenceSchema,
  GoalSchema,
  RunsteadEventSchema,
  TaskSchema
} from "@runstead/core";

import type { RunsteadDatabase } from "./index.js";

export type StateProjection =
  | { type: "goal"; value: Goal }
  | { type: "task"; value: Task }
  | { type: "evidence"; value: Evidence };

export interface AppendEventAndProjectInput {
  event: RunsteadEvent;
  projection?: StateProjection;
}

export function appendEventAndProject(
  database: RunsteadDatabase,
  input: AppendEventAndProjectInput
): void {
  const event = RunsteadEventSchema.parse(input.event);

  database.exec("BEGIN IMMEDIATE");

  try {
    insertEvent(database, event);

    if (input.projection !== undefined) {
      upsertProjection(database, input.projection);
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

function optionalJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}
