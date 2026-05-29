# AI-Coded MVP Readiness Runbook

Runstead's startup path is centered on one orchestrated readiness run. The goal
is not to make an agent "finish"; it is to leave behind evidence, measurement,
verifier output, UI smoke, reports, and a target-aware launch verdict.

## Golden Command

The default founder-facing path:

```bash
runstead startup ready \
  --cwd /path/to/mvp \
  --stage launch \
  --target local \
  --worker codex_direct \
  --governance governed
```

For an empty repo, add the built-in scaffold profile:

```bash
runstead startup ready \
  --cwd /path/to/empty-repo \
  --stage launch \
  --target local \
  --worker codex_direct \
  --governance governed \
  --app-template static-todo \
  --app-type local-first-web
```

The command output names the selected worker governance boundary:

- `codex_cli` and `claude_code` are Level 1 wrapped workers: Runstead governs
  launch, checkpoint, dependency policy, diff scope, verifier evidence, and
  reports, but cannot hard-proxy every internal tool call.
- `codex_direct` is the Level 2 native proxy: every exposed model tool call is
  evaluated by Runstead before it runs.

`--governance auto` (default) keeps local and staging targets on `codex_cli`
and routes production to `codex_direct` unless `--worker` overrides.
`--governance readiness` keeps Level 1; `--governance governed` requires
`codex_direct`.

By default the onboarding path is non-interactive and uses conservative
generated context and measurement defaults. Add `--interactive` to collect
founder-supplied architecture principles, constraints, accepted debt, and core
metrics. Add `--guided` to print persisted next-step commands for every
blocker.

For the `local` target, `startup ready` also records a conservative local
baseline when evidence is missing: problem/user/solution hypotheses,
disconfirming-signal review, metric snapshot, migration plan, rollback plan,
rollback drill, observability baseline, monitoring alerts, error budget,
migration validation, traffic gate, post-launch watch placeholder, release
plan, and founder bottleneck ownership. These records are marked as
local/manual or local-command evidence; they make a local launch review
smoother but do not replace staging deployment, production analytics,
support, or customer evidence.

## Phases

Each readiness run performs these phases:

1. check the selected runtime backend; an incomplete
   `RUNSTEAD_RUNTIME_BACKEND=postgres` team setup blocks before any worker runs
2. onboard repository and initialize Runstead state
3. generate or ingest agent context (`AGENTS.md`, `CLAUDE.md`, `CODEX.md`)
4. generate or ingest the measurement framework
5. run bounded MVP build/repair with the selected worker, or **skip the
   worker on the green path** when the current app surface already has
   discoverable test/lint/typecheck/build commands and matching verifier
   evidence
6. discover and run verifiers (test, lint, typecheck, build, plus any
   verifiers contributed by `.runstead/extensions`)
7. read or create `.runstead/startup/ui-smoke.yaml` and execute UI smoke
8. on UI smoke failure classified as `product_gap` or `selector_unstable`,
   write a structured repair-request artifact and run one bounded MVP repair
   attempt; abort cleanly on `browser_runtime` or `network` failure
9. run required extension collectors declared under `.runstead/extensions`
10. generate repo readiness and security audit evidence
11. generate launch readiness and decision reports
12. run the complete-product check

If the agent worker reports failure but the current code fingerprint matches
and verifiers pass, Runstead records the run as `completed_with_warnings`
under verifier-only recovery instead of `failed`.

## Common Flags

```bash
runstead startup ready --cwd /path/to/mvp --stage launch --target production --plan
runstead startup ready --cwd /path/to/mvp --resume <run-id>
runstead startup ready --cwd /path/to/mvp --force-build         # force agent, skip green path
runstead startup ready --cwd /path/to/mvp --refresh-context     # regenerate context docs
runstead startup ready --cwd /path/to/mvp --max-attempts 3      # bounded MVP repair attempts
runstead startup ready --cwd /path/to/mvp --live-runtime-backend # prove Postgres runner state before worker execution
```

For team-mode runs, combine `--live-runtime-backend` with
`RUNSTEAD_RUNTIME_BACKEND=postgres`. Runstead will connect to the shared
backend during the runtime-backend phase, read `runtime_runners`, and block
before worker execution when the live backend cannot be reached or no fresh
runner heartbeat is present. Add `--migrate-runtime-backend` to apply the
checked Postgres schema before the live probe.

## Outputs

The run persists a `StartupReadinessRun` under:

```text
.runstead/startup/readiness-runs/<run-id>.json
```

It also writes reports under `.runstead/reports/`, including:

- `startup-readiness-run-<run-id>.md`
- `startup-readiness-run-<run-id>.json`
- `launch-readiness-ai-native-startup.md` (target-specific status)
- `startup-complete-product-check.md`
- CI summary files when `--ci` is used
- `startup-artifact-hygiene.md` and `.json` when `runstead startup artifact hygiene` is run

Persisted run state includes guided steps and operator commands so the
dashboard and `runstead startup ready --resume` can pick up exactly where
the previous run left off. It also records the selected runtime backend,
storage URI, setup blockers, warnings, and team-readiness flag so reports and
dashboard snapshots can audit whether a local SQLite or Postgres team backend
was actually used for the run.

The CI summary separates Runstead's local release gate from remote GitHub
Actions state. Remote state is one of `passed`, `failed`, `pending`,
`unknown`, `not_configured`, or
`remote_ci_not_applicable_until_initial_commit`. Only `failed` and `pending`
block a release; `unknown` and `not_configured` are warnings.

The final surface answers:

- Can this local demo launch?
- Can this private beta or staging target launch?
- Can this public launch ship?
- What evidence or phase is blocking the requested target?
- Which evidence ids, source artifacts, timestamps, git SHA, fingerprints,
  and command output support the verdict?

## Local Dashboard And Operator Console

Build the dashboard once:

```bash
runstead dashboard build --cwd /path/to/mvp
```

Or serve it as a local HTTP UI:

```bash
runstead dashboard serve --cwd /path/to/mvp
```

The dashboard shows the latest readiness run, a run-comparison timeline
(latest completed vs latest blocked, resolved blockers, still-blocked
items), pending approvals, stale evidence count, blockers, resume command,
and recommended next command. It merges startup next actions, persisted
readiness run commands, guided-flow commands, and daemon approval-and-resume
commands. The same queue is exposed as JSON at `/operator-actions.json`.

By default the dashboard is read-only. Enable the protected Operator API to
approve, deny, resume, run verifiers, or record manual evidence over HTTP:

```bash
runstead dashboard serve --cwd /path/to/mvp --enable-operator-api
```

Runstead prints a session token and a CSRF token. Both must be sent on every
mutating request via `x-runstead-session-token` (or `Authorization: Bearer`)
and `x-runstead-csrf-token`. The server only binds local addresses and
rejects cross-origin requests. Mutating endpoints:

- `POST /operator-actions/<id>/run`
- `POST /approvals/<id>/(approve|deny)`
- `POST /runs/<id>/resume`
- `POST /verifiers/run`
- `POST /evidence/manual`

`POST /operator-actions/<id>/run` supports the persisted resume, approval,
complete-product audit, dashboard rebuild, and source refresh planning actions
shown in the operator queue. Every mutation still goes through Runstead policy,
RBAC, and audit; the API is a transport, not a bypass.
Operator actions that would start broader worker/build flows remain copy-only
until Runstead exposes a bounded API handler for that action type.

## UI Smoke

`startup ready` looks for:

```text
.runstead/startup/ui-smoke.yaml
```

Example:

```yaml
schemaVersion: 1
server:
  command: npm run dev
  port: 3000
  url: http://127.0.0.1:3000
  timeoutMs: 20000
checks:
  - name: home
    url: http://127.0.0.1:3000
    viewport: desktop
    expectText:
      - Dashboard
      - Add task
    flow: primary activation flow
    steps:
      - type: fill
        selectors:
          - "[data-testid='todo-input']"
          - "input[type='text']"
        value: Runstead smoke todo
      - type: click
        selectors:
          - "[data-testid='add-todo']"
          - "button[type='submit']"
      - type: expectText
        text: Runstead smoke todo
      - type: reload
      - type: expectPersisted
        text: Runstead smoke todo
```

If the file is missing but a `dev`, `start`, or `preview` script exists,
Runstead creates a default config. For todo/task apps the generated config
includes an add → toggle → search → reload-persistence golden path. If no
server command can be found, the UI phase becomes a blocker rather than a
silent skip.

Failures are classified through `@runstead/runtime`'s
`classifyRuntimeStartupUiValidationFailure`:

- `product_gap` and `selector_unstable` trigger one bounded auto-repair
  attempt via `startupBuildMvp`
- `browser_runtime` and `network` are recorded as blockers without invoking
  the agent (do not modify product code to chase tooling problems)

Failed runs save DOM, screenshot, console log, and managed server log
artifacts when available.

Supported UI smoke steps are `fill`, `select`, `click`, `expectText`,
`expectCount`, `reload`, and `expectPersisted`. Legacy
`startup.run`/`startup.readyWhen.url`/`checks[].expect.bodyContains` shapes
are still accepted for backward compatibility.

## Artifact Hygiene

Long dogfood runs leave evidence, report, startup, log, and checkpoint files
under `.runstead`. Generate a compact latest view and retention report:

```bash
runstead startup artifact hygiene --cwd /path/to/mvp --retention-days 30
```

Outputs:

- `.runstead/startup/latest-artifacts.json`
- `.runstead/reports/startup-artifact-hygiene.md`
- `.runstead/reports/startup-artifact-hygiene.json`

Files are classified as `current`, `referenced`, `superseded`, or
`unreferenced`. By default the command is report-only. Add `--prune` to
delete unreferenced files older than the retention window.

## Evidence Tiers

Runstead separates local evidence from launch-grade evidence:

| Tier                    | Source examples                                    |
| ----------------------- | -------------------------------------------------- |
| `synthetic_smoke`       | local UI smoke flow, local fixture commands        |
| `local_manual`          | founder-recorded plan/observation                  |
| `local_command`         | local test/lint/typecheck/build verifier output    |
| `ci_verified`           | GitHub Actions or other CI verifier evidence       |
| `staging_deployment`    | staging deploy URL with a verified health check    |
| `production_deployment` | production deploy URL with a verified health check |
| `real_user_analytics`   | PostHog / Amplitude / etc. evidence of real users  |
| `support_ticket`        | support, feedback, or incident triage record       |
| `security_scan`         | scanner reports or dependency audit                |

Target requirements:

- `--target local`: synthetic UI smoke and local command evidence are enough
- `--target staging`: additionally requires CI-verified, staging deployment,
  rollback drill, monitoring alerts, and migration validation
- `--target production`: additionally requires production deployment,
  real-user analytics, support or feedback triage, security scan, rollback
  plan, rollback drill, observability, monitoring alerts, error budget,
  migration validation, traffic gate, and post-launch watch

These rules are encoded in `@runstead/runtime`'s readiness verdict engine and
applied directly by `startup ready` and CI summaries. `startup status`,
`startup complete-check`, and the launch readiness report consume the latest
readiness verdict or target status so their surfaces stay aligned with that
engine.

## Readiness Extensions

Drop extension manifests into `.runstead/extensions/` to declare additional
facets, evidence collectors, verifiers, and gates. `startup ready` discovers
each manifest, compiles it with `@runstead/sdk`, applies collector policy
(safe-for-wrapped-worker, quality tier, freshness), and runs collector
commands through governed local execution.

See [docs/sdk.md](sdk.md) for the contract and
[docs/examples/extensions](examples/extensions) for copyable PostHog,
Vercel, Sentry, and GitHub Actions manifests.

## CI Integration

Generate the workflow in the product repo:

```bash
runstead startup ready --cwd /path/to/mvp --write-ci
```

The generated workflow runs:

```bash
runstead startup ready --stage launch --target local --ci
```

CI mode writes:

- markdown summary
- JSON artifact
- GitHub Check summary payload
- PR comment body
- release decision (`allow_release` or `block_release`) computed by the
  unified `compileReadinessReleaseDecision` engine in `@runstead/runtime`

## Manual Evidence Escape Hatches

The one-command run is the product path. Lower-level commands are available
when a team needs to attach stronger evidence before rerunning readiness:

```bash
runstead startup hypothesis add --cwd /path/to/mvp --kind problem --statement "..."
runstead startup hypothesis add --cwd /path/to/mvp --kind user --statement "..."
runstead startup hypothesis add --cwd /path/to/mvp --kind solution --statement "..."
runstead startup measurement snapshot --cwd /path/to/mvp --metric activation --threshold 1 --current 1
runstead startup evidence add --cwd /path/to/mvp --type rollback_plan --summary "..." --source docs/rollback-plan.md --gate launch
runstead startup evidence add --cwd /path/to/mvp --type rollback_drill --summary "..." --source docs/rollback-drill.md --gate launch
runstead startup evidence add --cwd /path/to/mvp --type observability --summary "..." --source docs/observability.md --gate launch
runstead startup evidence add --cwd /path/to/mvp --type monitoring_alerts --summary "..." --source docs/alerts.md --gate launch
runstead startup evidence add --cwd /path/to/mvp --type error_budget --summary "..." --source docs/error-budget.md --gate launch
runstead startup evidence add --cwd /path/to/mvp --type migration_validation --summary "..." --source docs/migration-validation.md --gate launch
runstead startup evidence add --cwd /path/to/mvp --type traffic_gate --summary "..." --source docs/traffic-gate.md --gate launch
runstead startup evidence add --cwd /path/to/mvp --type post_launch_watch --summary "..." --source docs/post-launch-watch.md --gate launch
runstead startup evidence manual-change \
  --cwd /path/to/mvp \
  --operator founder \
  --reason "agent omitted package scripts" \
  --diff-summary "added test/lint/typecheck/build scripts" \
  --file package.json \
  --command "pnpm test" \
  --evidence ev_after_fix \
  --gate launch
runstead startup source list
runstead startup source plan --cwd /path/to/mvp --target production
runstead startup source record --cwd /path/to/mvp --connector vercel --target staging --source-uri https://vercel.com/acme/todo/deployments/dpl_123 --summary "Staging deployment smoke passed" --status pass
runstead startup source collect --cwd /path/to/mvp --connector github_actions --target staging --source-uri https://api.github.com/repos/acme/todo/actions/runs/123
runstead startup source collect --cwd /path/to/mvp --connector posthog --target production --source-uri https://app.posthog.com/api/projects/1/insights/activation
runstead startup source verify --cwd /path/to/mvp --connector render --target production --source-uri https://todo.onrender.com/health --expect-status 200 --expect-text "ok"
runstead startup source record --cwd /path/to/mvp --connector posthog --target production --source-uri https://app.posthog.com/project/1/insights/activation --summary "Activation funnel uses real-user analytics" --status pass
runstead startup source verify --cwd /path/to/mvp --connector sentry --target production --source-uri https://sentry.io/organizations/acme/issues/?project=todo --expect-status 200 --expect-text "no open release blockers"
```

`startup evidence manual-change` is for operator interventions that happen
outside an agent loop. Launch reports show these records under Change
Authorship, separate from agent and verifier evidence.

`startup source collect` uses executable provider adapters for common systems
such as GitHub Actions, Vercel, Render, Sentry, and PostHog. `startup source
verify` remains the generic HTTP escape hatch because it performs a live check
before recording the evidence artifact. Named deployment connectors
(`vercel`, `fly`, `render`) and production connectors such as `sentry` and
`posthog` accept `--target`, so their artifacts carry readiness tiers like
`staging_deployment`, `production_deployment`, or `real_user_analytics`.
Provider adapters are deliberately defensive: malformed JSON, provider HTTP
errors, pending deployment or workflow states, and incomplete monitoring
payloads are recorded as explicit failed or unknown evidence instead of
crashing the run. Failed or unknown collected evidence does not grant target
readiness tiers such as `staging_deployment` or `real_user_analytics`.
Token-like response fields and the credential used for the request are
redacted before evidence is persisted.

`startup source plan --target staging|production` prints the required external
source refresh commands, credential blockers, adapter providers, and freshness
windows. Use it before launch runs and in scheduled CI/operator jobs so source
evidence is refreshed before its freshness window expires. Staging and
production readiness runs also persist this command in the guided flow and
operator action catalogue whenever external source connector evidence is part
of the target gate.

| Connector        | Credential Env      | Expected Provider Shape                                                                              |
| ---------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| `github_actions` | `GITHUB_TOKEN`      | workflow run JSON with `workflow`/`name`, `status`, `conclusion`, and commit/run id fields           |
| `gitlab_ci`      | `GITLAB_TOKEN`      | pipeline JSON with `pipeline`/`id`, `status`, `ref`, and commit SHA                                  |
| `linear`         | `LINEAR_API_KEY`    | issue JSON with `issueId`, `state`, `team`, and labels                                               |
| `jira`           | `JIRA_API_TOKEN`    | issue JSON with `issueKey`, `status`, `project`, and labels                                          |
| `slack`          | `SLACK_BOT_TOKEN`   | thread JSON with `channel`, `threadTs`, participants, and decision summary                           |
| `docs`           | `DOCS_API_TOKEN`    | document JSON with `document`, `title`, `updatedAt`, and URL                                         |
| `vercel`         | `VERCEL_TOKEN`      | deployment JSON with `readyState` or `status`, deployment URL, and commit SHA                        |
| `render`         | `RENDER_API_KEY`    | deploy JSON with `status`/`state`, service URL, and commit id                                        |
| `sentry`         | `SENTRY_AUTH_TOKEN` | release or issue JSON with `openReleaseBlockers`, `issueCount`, or `issues`                          |
| `posthog`        | `POSTHOG_API_KEY`   | metric JSON with `metric`, numeric `value`, optional `threshold`, `window`, and `realUserData: true` |

For `--target staging` and `--target production`, `startup ready --plan`
promotes these connector contracts into readiness requirements. Missing
remote CI credentials (`GITHUB_TOKEN` or `GITLAB_TOKEN`), deployment provider
credentials (`VERCEL_TOKEN` or `RENDER_API_KEY`), `SENTRY_AUTH_TOKEN`, or
production analytics credentials such as `POSTHOG_API_KEY` appear as explicit
setup blockers instead of local warnings. Final readiness evaluation consumes
the same requirements, so a staging or production verdict cannot silently
ignore missing external proof.

After stronger evidence is recorded, rerun the same gate:

```bash
runstead startup ready --cwd /path/to/mvp --stage launch --target production
```
