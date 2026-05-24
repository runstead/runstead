# AI-Coded MVP Readiness Runbook

Runstead's startup path is centered on one orchestrated readiness run. The goal
is not to make an agent "finish"; it is to leave behind evidence, measurement,
verifier output, UI smoke, reports, and a target-aware launch verdict.

## Golden Command

Use this as the default founder-facing path:

```bash
runstead startup ready \
  --cwd /path/to/mvp \
  --stage launch \
  --worker codex_cli \
  --target local
```

The command output names the selected worker governance boundary. `codex_cli`
is a Level 1 wrapped worker: Runstead governs launch, checkpoint, dependency
policy, diff scope, verifier evidence, and reports, but it does not hard-proxy
every internal Codex CLI tool call. Use `codex_direct` when the product promise
requires Runstead to govern exposed model tool calls through its native proxy.

By default the onboarding path is non-interactive and uses conservative
generated context and measurement defaults. Add `--interactive` to collect
founder-supplied architecture principles, constraints, accepted debt, and core
metrics before Runstead writes context/measurement artifacts and evidence.

For the `local` target, `startup ready` also records a conservative local
baseline when evidence is missing: problem/user/solution hypotheses,
disconfirming-signal review, metric snapshot, migration plan, rollback plan,
observability baseline, release plan, and founder bottleneck ownership. These
records are marked as local/manual or local-command evidence; they make a local
launch review smoother but do not replace staging deployment, production
analytics, support, or customer evidence.

The run performs these phases:

1. onboard repository and initialize Runstead state
2. generate agent context
3. generate the measurement framework
4. run bounded MVP build/repair with the selected worker
5. discover and run `test`, `lint`, `typecheck`, and `build`
6. read or create `.runstead/startup/ui-smoke.yaml` and execute UI smoke
7. generate repo readiness and security audit evidence
8. generate launch readiness and decision reports
9. run the complete-product check

Use `--plan` before a costly run:

```bash
runstead startup ready --cwd /path/to/mvp --stage launch --target production --plan
```

Use `--resume` after interruption:

```bash
runstead startup ready --cwd /path/to/mvp --resume <run-id>
```

## Outputs

The run persists a `StartupReadinessRun` under:

```text
.runstead/startup/readiness-runs/<run-id>.json
```

It also writes reports under `.runstead/reports/`, including:

- `startup-readiness-run-<run-id>.md`
- `startup-readiness-run-<run-id>.json`
- `launch-readiness-ai-native-startup.md`
- `startup-complete-product-check.md`
- CI summary files when `--ci` is used

The CI summary separates Runstead's local release gate from remote GitHub
Actions state. When a GitHub `origin` and `HEAD` are available, Runstead queries
the GitHub Actions API for the current commit. If the repo is private,
unauthenticated, or no run exists yet, the remote state is recorded as `unknown`
or `not_configured` instead of being treated as passed.

The final surface answers:

- Can this local demo launch?
- Can this private beta or staging target launch?
- Can this public launch ship?
- What evidence or phase is blocking the requested target?
- Which evidence ids, source artifacts, timestamps, git SHA, and command output
  support the verdict?

Serve the same state as a local dashboard:

```bash
runstead dashboard serve --cwd /path/to/mvp
```

The dashboard now includes an operator console with the latest readiness run,
pending approvals, blocker count, stale evidence count, resume command, and
recommended next command. It merges startup next actions, readiness run
commands, guided-flow commands, and daemon approval resume commands. The same
action queue is available at `/operator-actions.json` for local tooling.

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
Runstead creates a default config. If no server command can be found, the UI
phase becomes a blocker rather than a silent skip.

For compatibility with older agent-generated configs, Runstead also accepts the
legacy `startup.run` / `startup.readyWhen.url` shape and
`checks[].expect.bodyContains`. New configs should use `server`, `expectText`,
and optional `steps`.

Supported UI smoke steps are `fill`, `select`, `click`, `expectText`,
`expectCount`, `reload`, and `expectPersisted`. For todo/task apps, generated
configs include a golden path that adds a synthetic todo, toggles it, exercises
search/filter controls when present, and reloads to prove persistence. Flow
execution stores DOM, screenshot, console log, and managed server log artifacts
when available so a failed launch gate has inspectable evidence.

## Artifact Hygiene

Long dogfood runs can leave many evidence, report, startup, log, and checkpoint
files under `.runstead`. Generate a compact latest view and retention report:

```bash
runstead startup artifact hygiene --cwd /path/to/mvp --retention-days 30
```

The command writes:

- `.runstead/startup/latest-artifacts.json`
- `.runstead/reports/startup-artifact-hygiene.md`
- `.runstead/reports/startup-artifact-hygiene.json`

Files are classified as `current`, `referenced`, `superseded`, or
`unreferenced`. By default the command is report-only. Add `--prune` to delete
unreferenced files older than the retention window.

## Evidence Tiers

Runstead separates local evidence from launch-grade evidence:

- `synthetic_smoke`
- `local_manual`
- `local_command`
- `ci_verified`
- `staging_deployment`
- `production_deployment`
- `real_user_analytics`
- `support_ticket`
- `security_scan`

`--target local` can return `local_launch_ready` from local command and UI
evidence. `--target staging` additionally requires CI, staging deployment,
rollback drill, monitoring alert, and migration validation evidence. `--target
production` requires production deployment, rollback drill, monitoring alerts,
error budget, migration validation, traffic gate, real analytics, support or
feedback triage, security evidence, and a post-launch watch record.

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

## Manual Evidence Escape Hatches

The one-command run is the product path. The lower-level commands are still
available when a team needs to attach stronger evidence before rerunning
readiness:

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
runstead startup evidence manual-change --cwd /path/to/mvp --operator founder --reason "agent omitted package scripts" --diff-summary "added test/lint/typecheck/build scripts" --file package.json --command "pnpm test" --evidence ev_after_fix --gate launch
runstead startup source list
runstead startup source record --cwd /path/to/mvp --connector vercel --target staging --source-uri https://vercel.com/acme/todo/deployments/dpl_123 --summary "Staging deployment smoke passed" --status pass
runstead startup source verify --cwd /path/to/mvp --connector render --target production --source-uri https://todo.onrender.com/health --expect-status 200 --expect-text "ok"
runstead startup source record --cwd /path/to/mvp --connector posthog --target production --source-uri https://app.posthog.com/project/1/insights/activation --summary "Activation funnel uses real-user analytics" --status pass
runstead startup source verify --cwd /path/to/mvp --connector sentry --target production --source-uri https://sentry.io/organizations/acme/issues/?project=todo --expect-status 200 --expect-text "no open release blockers"
```

`startup evidence manual-change` is for operator interventions that happen
outside an agent loop. Launch reports show these records under Change
Authorship, separate from agent and verifier evidence.

`startup source verify` is the preferred escape hatch for staging and
production integrations because it performs a live HTTP check before recording
the evidence artifact. Named deployment connectors (`vercel`, `fly`, `render`)
and production connectors such as `sentry` and `posthog` accept `--target`, so
their artifacts carry readiness tiers like `staging_deployment`,
`production_deployment`, or `real_user_analytics`. Use them for deployment
health URLs, observability status pages, analytics exports, billing health
endpoints, support queues, or scanner reports that can expose a stable URL.

After stronger evidence is recorded, rerun the same gate:

```bash
runstead startup ready --cwd /path/to/mvp --stage launch --target production
```
