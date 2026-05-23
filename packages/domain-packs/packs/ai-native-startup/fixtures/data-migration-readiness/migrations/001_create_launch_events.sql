CREATE TABLE launch_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX launch_events_workspace_created_idx
  ON launch_events (workspace_id, created_at);
