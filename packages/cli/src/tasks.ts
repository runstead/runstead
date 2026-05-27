import { createRunsteadId, type RunsteadEvent, type Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import {
  executionLeaseExpiresAt,
  executionLeaseOwnerId
} from "./task-execution-lease.js";
import { rowToTask, type TaskRow } from "./task-rows.js";
import { insertTaskEvent, resolveTaskStateDb } from "./task-state.js";
import type {
  BlockTaskOptions,
  ClaimTaskOptions,
  ClaimTaskResult,
  ListTasksOptions,
  ListTasksResult,
  ShowTaskOptions,
  ShowTaskResult,
  UpdateTaskResult
} from "./tasks-types.js";

export {
  buildCommandVerifierDomainTask,
  buildDomainTask,
  buildRunLocalVerifiersTask
} from "./task-builders.js";
export { createRunLocalVerifiersTask } from "./task-create.js";
export type {
  BuildDomainTaskOptions,
  BuildRunLocalVerifiersTaskOptions
} from "./task-builders.js";
export type {
  BlockTaskOptions,
  ClaimTaskOptions,
  ClaimTaskResult,
  CreateRunLocalVerifiersTaskOptions,
  CreateTaskResult,
  ListTasksOptions,
  ListTasksResult,
  ShowTaskOptions,
  ShowTaskResult,
  UpdateTaskResult
} from "./tasks-types.js";

export function listTasks(options: ListTasksOptions = {}): ListTasksResult {
  const stateDb = resolveTaskStateDb(options.cwd);
  const database = openRunsteadDatabase(stateDb);

  try {
    const rows =
      options.goalId === undefined
        ? (database
            .prepare(
              `
              SELECT id, goal_id, domain, type, status, priority, attempt,
                     max_attempts, input_json, output_json, verifiers_json,
                     created_at, updated_at
              FROM tasks
              ORDER BY created_at DESC, id ASC
            `
            )
            .all() as unknown as TaskRow[])
        : (database
            .prepare(
              `
              SELECT id, goal_id, domain, type, status, priority, attempt,
                     max_attempts, input_json, output_json, verifiers_json,
                     created_at, updated_at
              FROM tasks
              WHERE goal_id = ?
              ORDER BY created_at DESC, id ASC
            `
            )
            .all(options.goalId) as unknown as TaskRow[]);

    return {
      tasks: rows.map(rowToTask),
      stateDb
    };
  } finally {
    database.close();
  }
}

export function showTask(options: ShowTaskOptions): ShowTaskResult {
  const stateDb = resolveTaskStateDb(options.cwd);
  const database = openRunsteadDatabase(stateDb);

  try {
    const row = database
      .prepare(
        `
        SELECT id, goal_id, domain, type, status, priority, attempt,
               max_attempts, input_json, output_json, verifiers_json,
               created_at, updated_at
        FROM tasks
        WHERE id = ?
      `
      )
      .get(options.id) as TaskRow | undefined;

    if (row === undefined) {
      throw new Error(`Task not found: ${options.id}`);
    }

    return {
      task: rowToTask(row),
      stateDb
    };
  } finally {
    database.close();
  }
}

export function claimTask(options: ClaimTaskOptions): ClaimTaskResult {
  const stateDb = resolveTaskStateDb(options.cwd);
  const claimedAt = (options.now ?? new Date()).toISOString();
  const database = openRunsteadDatabase(stateDb);
  let inTransaction = false;

  try {
    database.exec("BEGIN IMMEDIATE");
    inTransaction = true;

    const row = database
      .prepare(
        `
        SELECT id, goal_id, domain, type, status, priority, attempt,
               max_attempts, input_json, output_json, verifiers_json,
               created_at, updated_at
        FROM tasks
        WHERE id = ?
      `
      )
      .get(options.id) as TaskRow | undefined;

    if (row === undefined) {
      throw new Error(`Task not found: ${options.id}`);
    }

    const current = rowToTask(row);

    if (current.status !== "queued") {
      throw new Error(`Task ${options.id} is ${current.status}, expected queued`);
    }

    const task: Task = {
      ...current,
      status: "claimed",
      updatedAt: claimedAt
    };
    const event: RunsteadEvent = {
      eventId: createRunsteadId("evt"),
      type: "task.claimed",
      aggregateType: "task",
      aggregateId: task.id,
      payload: {
        previousStatus: current.status
      },
      createdAt: claimedAt
    };
    const update = database
      .prepare(
        `
        UPDATE tasks
        SET status = ?, owner_id = ?, heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
        WHERE id = ? AND status = ?
      `
      )
      .run(
        task.status,
        executionLeaseOwnerId(),
        claimedAt,
        executionLeaseExpiresAt(claimedAt),
        task.updatedAt,
        task.id,
        current.status
      ) as { changes: number };

    if (update.changes !== 1) {
      throw new Error(`Task ${options.id} could not be claimed atomically`);
    }

    insertTaskEvent(database, event);
    database.exec("COMMIT");
    inTransaction = false;

    return {
      task,
      event,
      stateDb
    };
  } catch (error) {
    if (inTransaction) {
      database.exec("ROLLBACK");
    }

    throw error;
  } finally {
    database.close();
  }
}

export function blockTask(options: BlockTaskOptions): UpdateTaskResult {
  const stateDb = resolveTaskStateDb(options.cwd);
  const blockedAt = (options.now ?? new Date()).toISOString();
  const task: Task = {
    ...options.task,
    status: "blocked",
    output: {
      ...(options.task.output ?? {}),
      ...(options.output ?? {}),
      reason: options.reason
    },
    updatedAt: blockedAt
  };
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "task.blocked",
    aggregateType: "task",
    aggregateId: task.id,
    payload: {
      previousStatus: options.task.status,
      ...(options.output ?? {}),
      reason: options.reason
    },
    createdAt: blockedAt
  };
  const database = openRunsteadDatabase(stateDb);

  try {
    appendEventAndProject(database, {
      event,
      projection: {
        type: "task",
        value: task
      }
    });
  } finally {
    database.close();
  }

  return {
    task,
    event,
    stateDb
  };
}
