import { GoalSchema, type Goal, type JsonObject } from "@runstead/core";

export interface GoalRow {
  id: string;
  domain: string;
  title: string;
  status: string;
  priority: string;
  scope_json: string;
  budget_json: string | null;
  policy_ref: string | null;
  acceptance_ref: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToGoal(row: GoalRow): Goal {
  return GoalSchema.parse({
    id: row.id,
    domain: row.domain,
    title: row.title,
    status: row.status,
    priority: row.priority,
    scope: JSON.parse(row.scope_json) as JsonObject,
    ...(row.budget_json === null
      ? {}
      : { budget: JSON.parse(row.budget_json) as JsonObject }),
    ...(row.policy_ref === null ? {} : { policyRef: row.policy_ref }),
    ...(row.acceptance_ref === null ? {} : { acceptanceRef: row.acceptance_ref }),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}
