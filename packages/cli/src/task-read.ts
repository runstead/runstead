import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { rowToTask, type TaskRow } from "./task-rows.js";
import { resolveTaskStateDb } from "./task-state.js";
import type {
  ListTasksOptions,
  ListTasksResult,
  ShowTaskOptions,
  ShowTaskResult
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
