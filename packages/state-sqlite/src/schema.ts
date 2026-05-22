export const RUNSTEAD_SCHEMA_VERSION = 1;

export interface RunsteadSchemaMigration {
  version: number;
  name: string;
  sql: string;
}

export const schemaMigrationsTableSql = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`;

export const initialSchemaSql = `
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  budget_json TEXT,
  policy_ref TEXT,
  acceptance_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  input_json TEXT NOT NULL,
  output_json TEXT,
  verifiers_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(goal_id) REFERENCES goals(id)
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  uri TEXT NOT NULL,
  hash TEXT,
  summary TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_decisions (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  risk TEXT NOT NULL,
  rule_id TEXT,
  reason TEXT NOT NULL,
  obligations_json TEXT NOT NULL,
  action_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  policy_decision_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  status TEXT NOT NULL,
  risk TEXT NOT NULL,
  reason TEXT NOT NULL,
  requested_by TEXT,
  expires_at TEXT,
  decided_at TEXT,
  decided_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worker_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  worker_type TEXT NOT NULL,
  status TEXT NOT NULL,
  enforcement_level TEXT NOT NULL,
  checkpoint_before TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  output_json TEXT,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  worker_run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL,
  policy_decision_id TEXT,
  input_json TEXT NOT NULL,
  output_json TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  FOREIGN KEY(worker_run_id) REFERENCES worker_runs(id),
  FOREIGN KEY(task_id) REFERENCES tasks(id),
  FOREIGN KEY(policy_decision_id) REFERENCES policy_decisions(id)
);

CREATE TABLE IF NOT EXISTS memory_records (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence REAL NOT NULL,
  content TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  conflicts_with_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  alias TEXT UNIQUE NOT NULL,
  local_path TEXT UNIQUE NOT NULL,
  remote_url TEXT,
  default_branch TEXT,
  status TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export const runsteadSchemaMigrations: RunsteadSchemaMigration[] = [
  {
    version: 1,
    name: "initial_state_schema",
    sql: initialSchemaSql
  }
];

export const createSchemaSql = `${schemaMigrationsTableSql}\n${initialSchemaSql}`;
