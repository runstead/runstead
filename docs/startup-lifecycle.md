# Startup Lifecycle

Runstead maps the AI-native startup lifecycle to domain packs and stage gates.
The product stance is not "help founders use more AI." It is governed,
evidence-backed execution for real startup work.

## Stage Map

### Idea Stage: Validation Pack

Goal: prevent premature build.

Core artifacts:

- hypothesis ledger for problem, user, and solution assumptions
- evidence registry for interviews, competitor research, feedback, and failed
  attempts
- disconfirming evidence check
- build gate that blocks or warns when validation evidence is missing

### MVP Stage: MVP Build Pack

Goal: make agent-built products understandable and verifiable.

Core artifacts:

- generated and maintained agent context such as `CLAUDE.md`, `AGENTS.md`,
  and `CODEX.md`
- architecture principles and technical constraints
- accepted technical debt records
- discovered package scripts and verifier commands
- measurement framework covering activation, retention, Day 7 or Day 30
  metrics, and false-positive metrics
- diff summaries, verifier evidence, and audit reports after agent edits

This is the first startup pack to ship because it directly extends
repo-maintenance.

### Launch Stage: Launch Readiness Pack

Goal: decide whether an AI-coded MVP can safely launch.

Report sections:

- repo health
- verifier status (local command, CI, extension-contributed)
- test coverage gaps
- dependency and security risk
- protected path changes
- architectural debt
- missing observability
- target-specific release blockers (rollback drill, monitoring alerts, error
  budget, migration validation, traffic gate, post-launch watch)
- acceptable debt
- next sprint remediation plan
- run-comparison timeline (latest completed vs latest blocked, resolved
  blockers, still-blocked items)

### Scale Stage: Ops Handoff Pack

Goal: move execution from founder memory into governed operating artifacts.

Core artifacts:

- workflow registry
- delegation policy
- institutional memory
- recurring reports
- support triage records
- GTM artifact verification
- integration depth map

This stage follows MVP and Launch readiness so the product does not drift
into a generic operations tool too early. The `ai-native-startup` pack
exposes this as the `scale-ops` template so the artifacts are defined
without making ops the first product surface.

## Current CLI Shape

The short founder path is the readiness orchestrator:

```sh
runstead startup ready --cwd /path/to/mvp --stage launch --target local --worker codex_direct --governance governed
runstead startup ready --cwd /path/to/mvp --stage launch --target production --plan
runstead startup ready --cwd /path/to/mvp --resume <run-id>
runstead startup ready --cwd /path/to/mvp --force-build           # override green-path skip
runstead startup ready --cwd /path/to/mvp --app-template static-todo --app-type local-first-web   # empty repo
```

`codex_direct` is the recommended worker when each model tool call must
go through Runstead-native policy and audit. `codex_cli` and `claude_code`
are the Level 1 wrapped-worker paths. `--governance auto` (default) keeps
local and staging readiness on `codex_cli` but selects `codex_direct` for
production targets.

The artifact-first command surface remains available for precise evidence
work before rerunning `startup ready`:

```sh
runstead startup hypothesis add --cwd /path/to/mvp --kind problem --statement "..."
runstead startup hypothesis add --cwd /path/to/mvp --kind user --statement "..."
runstead startup hypothesis add --cwd /path/to/mvp --kind solution --statement "..."
runstead startup evidence add --cwd /path/to/mvp --type disconfirming --summary "..."
runstead startup measurement snapshot --cwd /path/to/mvp --metric activation_flow_completion --threshold 1 --current 1
runstead startup launch ui-validate --cwd /path/to/mvp --execute --url http://127.0.0.1:3000
runstead startup launch audit --cwd /path/to/mvp
runstead startup launch security-baseline --cwd /path/to/mvp
runstead startup launch git-summary --cwd /path/to/mvp
runstead startup evidence add --cwd /path/to/mvp --type migration_plan --summary "..." --owner founder
runstead startup evidence add --cwd /path/to/mvp --type rollback_plan --summary "..." --owner founder
runstead startup evidence add --cwd /path/to/mvp --type rollback_drill --summary "..." --owner founder
runstead startup evidence add --cwd /path/to/mvp --type observability --summary "..." --owner founder
runstead startup evidence add --cwd /path/to/mvp --type monitoring_alerts --summary "..." --owner founder
runstead startup evidence add --cwd /path/to/mvp --type error_budget --summary "..." --owner founder
runstead startup evidence add --cwd /path/to/mvp --type migration_validation --summary "..." --owner founder
runstead startup evidence add --cwd /path/to/mvp --type traffic_gate --summary "..." --owner founder
runstead startup evidence add --cwd /path/to/mvp --type post_launch_watch --summary "..." --owner founder
runstead startup evidence manual-change --cwd /path/to/mvp --operator founder --reason "..." --diff-summary "..." --file package.json --gate launch
runstead startup source list
runstead startup source record --cwd /path/to/mvp --connector vercel --target staging --source-uri https://vercel.com/acme/app/deployments/dpl_123 --summary "..." --status pass
runstead startup source verify --cwd /path/to/mvp --connector sentry --target production --source-uri https://sentry.io/... --expect-status 200 --expect-text "no open release blockers"
runstead startup gate check --cwd /path/to/mvp --stage launch
```

The scale path records operating evidence rather than implying real scale:

```sh
runstead startup launch bottleneck-map --cwd /path/to/mvp --bottleneck "..."
runstead startup scale workflow-registry --cwd /path/to/mvp --workflow "..."
runstead startup scale memory-capture --cwd /path/to/mvp --knowledge "..."
runstead startup scale integration-map --cwd /path/to/mvp --integration "..."
runstead startup scale sop-generate --cwd /path/to/mvp --sop "..."
runstead startup launch support-triage --cwd /path/to/mvp --request "..." --outcome "..."
runstead startup scale gtm-verify --cwd /path/to/mvp --claim "..."
runstead startup scale schedule-report --cwd /path/to/mvp --owner founder --next-run 2026-05-29
runstead startup scale report --cwd /path/to/mvp --period 2026-W21
runstead startup gate check --cwd /path/to/mvp --stage scale
```

Replay or test gate fixtures against the unified verdict engine:

```sh
runstead startup gate test path/to/gate-fixture.json
```

Local dashboard and operator console:

```sh
runstead dashboard build --cwd /path/to/mvp
runstead dashboard serve --cwd /path/to/mvp
runstead dashboard serve --cwd /path/to/mvp --enable-operator-api
```

See [ai-coded-mvp-readiness.md](ai-coded-mvp-readiness.md) for the complete
runbook and [startup-ready-golden-path.md](startup-ready-golden-path.md) for
the todo fixture dogfood path.

## Scope Discipline

Runstead should not become:

- an AI startup mentor
- a Claude or Codex wrapper
- a project management clone
- a Zapier-style automation surface
- another agent framework

It should keep returning to governed, evidence-backed execution: goals,
policies, verifiers, evidence, checkpoints, audits, stage gates, reports,
and resume paths.
