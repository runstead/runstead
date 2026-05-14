export const REQUIRED_STATE_TABLES = [
  "goals",
  "tasks",
  "evidence",
  "policy_decisions",
  "approvals",
  "worker_runs",
  "tool_calls",
  "memory_records",
  "repositories",
  "events"
];

export function missingRequiredStateTables(tableNames: Iterable<string>): string[] {
  const existing = new Set(tableNames);

  return REQUIRED_STATE_TABLES.filter((table) => !existing.has(table));
}
