# Migration Plan

Forward path:

- create `launch_events`
- backfill launch event rows from current workspace activity
- verify row counts by workspace

Integrity checks:

- every row has `workspace_id`, `event_type`, and `created_at`
- migrated row count equals source activity count
- failed backfill emits an observability event
