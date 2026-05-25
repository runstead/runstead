# Daemon

Runstead daemon mode runs scheduler ticks and task execution under the
workspace manager lock.

Scheduler ticks create due recurring tasks from installed domain pack task
type contracts. `repo-maintenance` keeps a specialized `run_local_verifiers`
path so test and lint commands are detected from the target repository
before the task is queued.

Long-running daemon loops refresh the manager lock heartbeat after each
tick. This keeps stale-lock recovery tied to actual daemon progress instead
of only the original acquisition time.

For bounded local runs:

```sh
runstead daemon --once
runstead daemon --max-ticks 5 --interval-ms 30000
```

Each real daemon tick writes `.runstead/daemon/status.json` by default. The
heartbeat records the process id, tick number, timestamp, scheduling
counts, last task result, and CI repair branch/approval/PR progress when
the tick ran a repair orchestration, so operators can tell whether the
daemon is alive without opening SQLite.

Inspect the last heartbeat:

```sh
runstead daemon --status
```

Status output marks the heartbeat stale when its timestamp is older than
twice the `--interval-ms` value used for the status command.

`runstead dashboard build` requires `dashboard.manage` because it writes
dashboard files. It also embeds the latest heartbeat and its healthy/stale
status in `dashboard/state.json` and the generated HTML dashboard.

Use `--no-heartbeat` only for tests or wrapper environments that provide
their own liveness signal.

## Task Lease Recovery

Tasks and worker runs carry an `lease_expires_at` column. When a daemon or
agent process crashes mid-run, those rows are left in `claimed` or
`running` past their lease. `runstead resume` re-queues retryable tasks
past their lease, fails interrupted worker runs and tool calls, and
records the resume decision in the audit log.

For unattended environments, run `runstead resume` at startup before
calling `runstead daemon --once` or `runstead daemon --max-ticks ...`.

## Webhook Intake

GitHub webhook deliveries are recorded with their `x-github-delivery` id.
When the CLI server receives a repeated delivery id, Runstead records a
`webhook.delivery_duplicate` audit event and skips intake/orchestration
before any CI repair side effects run. With delivery dedupe enabled,
Runstead also records `webhook.delivery_received` before starting intake or
orchestration so a concurrent duplicate delivery sees an in-flight
reservation instead of starting a second repair loop.

## GitHub App Auth

Webhook intake and CI repair orchestration can use a configured GitHub App
installation instead of ambient `gh` credentials:

```sh
runstead github app init \
  --app-id 12345 \
  --installation-id 67890 \
  --private-key ./github-app.pem

runstead webhook serve \
  --secret "$GITHUB_WEBHOOK_SECRET" \
  --github-app \
  --orchestrate-repair \
  --verifier test="pnpm test"
```

`--github-app` is also available on `runstead github run status`,
`runstead github run logs`, `runstead github run repair`,
`runstead github run orchestrate-repair`, `runstead github pr create`, and
the top-level `runstead repair-ci` helper. Passing `--installation-id`
overrides the configured installation id for that invocation.

Installation tokens are minted just in time and passed to `gh` through
`GH_TOKEN`. Runstead records that a token was created, including app id,
installation id, expiry, and repository selection when available, but it
does not store the token value in SQLite, audit exports, or PR bodies.
Commands that print credentials directly, `runstead github app jwt` and
`runstead github app token`, require `--print-secret`.

## Dashboard And Operator API

The dashboard HTTP server is the operator-facing surface for daemon
activity. Read-only by default:

```sh
runstead dashboard serve --cwd /path/to/repo
```

Opt-in mutating Operator API:

```sh
runstead dashboard serve --cwd /path/to/repo --enable-operator-api
```

When enabled, the daemon's pending approvals show up as
`runstead approval approve-and-resume <id>` actions in the operator
console. Use `POST /operator-actions/<id>/run` to execute that combined
operator action through the local API, or use `POST /approvals/<id>/approve`
when you only want to approve and handle resume separately. Both require the
printed session and CSRF tokens. See [security-model.md](security-model.md)
for the auth boundary.
