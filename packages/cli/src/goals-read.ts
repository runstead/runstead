import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDbSync } from "./runstead-root.js";
import { rowToGoal, type GoalRow } from "./goals-rows.js";
import type {
  ListGoalsOptions,
  ListGoalsResult,
  ShowGoalOptions,
  ShowGoalResult
} from "./goals-types.js";

export function listGoals(options: ListGoalsOptions = {}): ListGoalsResult {
  const stateDb = resolveStateDb(options.cwd);
  const database = openRunsteadDatabase(stateDb);

  try {
    const rows = database
      .prepare(
        `
        SELECT id, domain, title, status, priority, scope_json, budget_json,
               policy_ref, acceptance_ref, created_at, updated_at
        FROM goals
        ORDER BY created_at DESC, id ASC
      `
      )
      .all() as unknown as GoalRow[];

    return {
      goals: rows.map(rowToGoal),
      stateDb
    };
  } finally {
    database.close();
  }
}

export function showGoal(options: ShowGoalOptions): ShowGoalResult {
  const stateDb = resolveStateDb(options.cwd);
  const database = openRunsteadDatabase(stateDb);

  try {
    const row = database
      .prepare(
        `
        SELECT id, domain, title, status, priority, scope_json, budget_json,
               policy_ref, acceptance_ref, created_at, updated_at
        FROM goals
        WHERE id = ?
      `
      )
      .get(options.id) as GoalRow | undefined;

    if (row === undefined) {
      throw new Error(`Goal not found: ${options.id}`);
    }

    return {
      goal: rowToGoal(row),
      stateDb
    };
  } finally {
    database.close();
  }
}

function resolveStateDb(cwd = process.cwd()): string {
  return requireRunsteadStateDbSync(cwd).stateDb;
}
