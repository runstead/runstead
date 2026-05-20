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

## Recommended CLI Shape

The short-term CLI should stay artifact-first:

```sh
runstead domain install ai-native-startup
runstead goal create ai-native-startup --template build-mvp
runstead run --once
runstead report launch-readiness --domain ai-native-startup
```

Startup aliases can make the founder workflow easier once the domain pack is
stable:

```sh
runstead startup init --stage mvp
runstead startup context generate
runstead startup evidence add --type customer_interview
runstead startup gate check --stage launch
runstead startup report launch-readiness
```

The first implemented startup commands are narrower and artifact-first:

```sh
runstead startup init --stage mvp
runstead startup hypothesis add --kind problem --statement "..."
runstead startup hypothesis add --kind user --statement "..."
runstead startup hypothesis add --kind solution --statement "..."
runstead startup evidence add --type disconfirming --summary "..."
runstead startup gate check --stage mvp
runstead startup context generate --force
runstead startup measurement generate --force
runstead startup launch audit
runstead startup launch security-baseline
runstead startup launch support-triage --request "..." --outcome "..."
runstead startup launch bottleneck-map --bottleneck "..."
runstead startup evidence add --type customer_interview --summary "..."
runstead startup evidence add --type measurement_framework --summary "..."
runstead startup evidence add --type migration_plan --summary "..."
runstead startup evidence add --type rollback_plan --summary "..."
runstead startup evidence add --type observability --summary "..."
runstead startup gate check --stage launch
runstead startup scale workflow-registry --workflow "..."
runstead startup scale memory-capture --knowledge "..."
runstead startup scale integration-map --integration "..."
runstead startup scale sop-generate --sop "..."
runstead startup scale gtm-verify --claim "..."
runstead startup scale report --period 2026-W20
runstead startup gate check --stage scale
```

## Scope Discipline

Runstead should not become:

- an AI startup mentor
- a Claude or Codex wrapper
- a project management clone
- a Zapier-style automation surface
- another agent framework

It should keep returning to governed, evidence-backed execution: goals,
policies, verifiers, evidence, checkpoints, audits, stage gates, and reports.
