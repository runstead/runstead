# Daemon

Runstead daemon mode runs scheduler ticks and task execution under the workspace
manager lock.

Scheduler ticks create due recurring tasks from installed domain pack task type
contracts. `repo-maintenance` keeps a specialized `run_local_verifiers` path so
test and lint commands are detected from the target repository before the task is
queued.

For bounded local runs:

```sh
runstead daemon --once
runstead daemon --max-ticks 5 --interval-ms 30000
```

Each real daemon tick writes `.runstead/daemon/status.json` by default. The
heartbeat records the process id, tick number, timestamp, scheduling counts, and
last task result so operators can tell whether the daemon is alive without
opening SQLite.

Inspect the last heartbeat:

```sh
runstead daemon --status
```

Status output marks the heartbeat stale when its timestamp is older than twice
the `--interval-ms` value used for the status command.

`runstead dashboard build` also embeds the latest heartbeat and its healthy/stale
status in `dashboard/state.json` and the generated HTML dashboard.

Use `--no-heartbeat` only for tests or wrapper environments that provide their
own liveness signal.

GitHub webhook deliveries are recorded with their `x-github-delivery` id. When
the CLI server receives a repeated delivery id, Runstead records a
`webhook.delivery_duplicate` audit event and skips intake/orchestration before
any CI repair side effects run.
