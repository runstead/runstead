# Daemon

Runstead daemon mode runs scheduler ticks and task execution under the workspace
manager lock.

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

Use `--no-heartbeat` only for tests or wrapper environments that provide their
own liveness signal.
