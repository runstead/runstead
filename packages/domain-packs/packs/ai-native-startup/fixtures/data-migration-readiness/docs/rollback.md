# Rollback Plan

Rollback path:

- stop writes to `launch_events`
- export migrated rows for audit
- drop `launch_events`
- restore feature flag to the pre-migration event reader

Public launch remains blocked until the rollback command is rehearsed locally.
