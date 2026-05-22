# Startup Lifecycle

Runstead should map the AI-native startup lifecycle to domain packs and stage
gates. The product stance is not "help founders use more AI." It is governed,
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

- generated and maintained agent context such as `CLAUDE.md`, `AGENTS.md`, and
  `CODEX.md`
- architecture principles and technical constraints
- accepted technical debt records
- discovered package scripts and verifier commands
- measurement framework covering activation, retention, Day 7 or Day 30 metrics,
  and false-positive metrics
- diff summaries, verifier evidence, and audit reports after agent edits

This is the first startup pack to ship because it directly extends
repo-maintenance.

### Launch Stage: Launch Readiness Pack

Goal: decide whether an AI-coded MVP can safely launch.

Report sections:

- repo health
- verifier status
- test coverage gaps
- dependency and security risk
- protected path changes
- architectural debt
- missing observability
- release blockers
- acceptable debt
- next sprint remediation plan

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

This stage should follow MVP and Launch readiness so the product does not drift
into a generic operations tool too early. The `ai-native-startup` pack exposes
this as the `scale-ops` template so the artifacts are defined without making ops
the first product surface.

## Current CLI Shape

The startup workflow is now exposed through `runstead startup` aliases. The
short founder path is the readiness orchestrator:

```sh
runstead startup ready --cwd /path/to/mvp --stage launch --worker codex_cli --target local
runstead startup ready --cwd /path/to/mvp --stage launch --target production --plan
runstead startup ready --cwd /path/to/mvp --resume <run-id>
```

`codex_cli` is the recommended default worker for the founder-facing path.
`codex_direct` is the strict-governance path when each model tool call must go
through Runstead-native policy and audit.

The artifact-first command surface remains available for precise evidence work
before rerunning `startup ready`:

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
runstead startup evidence add --cwd /path/to/mvp --type migration_plan --summary "..." --owner founder --remediation-task "..." --acceptance-criteria "..."
runstead startup evidence add --cwd /path/to/mvp --type rollback_plan --summary "..." --owner founder --remediation-task "..." --acceptance-criteria "..."
runstead startup evidence add --cwd /path/to/mvp --type observability --summary "..." --owner founder --remediation-task "..." --acceptance-criteria "..."
runstead startup source record --cwd /path/to/mvp --connector deployment --source-uri http://127.0.0.1:3000 --summary "..." --status pass
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

See [ai-coded-mvp-readiness.md](ai-coded-mvp-readiness.md) for the complete
runbook and [startup-ready-golden-path.md](startup-ready-golden-path.md) for the
todo fixture dogfood path.

## Scope Discipline

Runstead should not become:

- an AI startup mentor
- a Claude or Codex wrapper
- a project management clone
- a Zapier-style automation surface
- another agent framework

It should keep returning to governed, evidence-backed execution: goals,
policies, verifiers, evidence, checkpoints, audits, stage gates, and reports.
