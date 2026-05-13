export const createSchemaSql = `
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
