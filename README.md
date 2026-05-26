# Runstead

Runstead is the control plane for AI-coded products that need evidence,
measurement, gates, and audit trails before they are treated as ready.

Coding agents execute. Runstead governs the work around them: goals, policies,
checkpoints, dependency boundaries, verifiers, launch evidence, stage gates,
reports, resume paths, and a local operator console.

The current product focus is **AI-coded MVP / startup launch readiness**:

> Help teams move agent-built products from MVP to launch to scale with evidence
> and gates, not just "the agent finished."

## What Runstead Does

Runstead turns agent work into reviewable execution records:

- initializes startup/repo readiness workspaces
- generates agent context and measurement frameworks
- runs Codex or Claude workers inside governed tasks
- checkpoints the workspace before edits
- enforces policy and approval boundaries
- runs test, lint, typecheck, build, UI, and launch verifiers
- discovers and executes third-party readiness extensions (facets, collectors,
  verifiers, gates) declared under `.runstead/extensions`
- records command output, browser/UI, deployment, analytics, support, security,
  and decision evidence — and HTTP-verifies external source URIs
- checks MVP, launch, scale, and complete-product gates
- produces markdown/JSON reports, a local HTTP dashboard, an operator console,
  diagnostics, and audit trails
- skips the agent on green reruns and recovers from worker failure when current
  verifier evidence proves the app
- bounded retry, abort, and resume for transient model calls and approved
  pending patches

Runstead is not a replacement for Codex CLI, Claude Code, CI, deployment
platforms, or analytics. It is the control plane that makes their output
bounded, evidenced, auditable, resumable, and team-shareable.

## Worker Modes

| Mode           | Best for                                                         | Governance                                                                                                                    | Tradeoff                                                 |
| -------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `codex_cli`    | Default MVP build, normal local coding, practical speed          | Level 1 wrapped worker: gated launch, checkpoint, post-run verifier evidence, audit                                           | Worker-internal tool calls are not hard-proxied          |
| `codex_direct` | Strict audit, protected workspaces, compliance-sensitive changes | Level 2 native proxy: model-exposed filesystem, shell, git-read, verifier, and evidence-read calls go through Runstead policy | Heavier approval/policy setup and smaller tool ecosystem |
| `claude_code`  | Teams standardized on Claude Code CLI                            | Level 1 wrapped worker                                                                                                        | Same wrapped-worker boundary as `codex_cli`              |

`startup ready` selects the governance level explicitly:

- `--governance readiness` allows Level 1 wrapped workers (`codex_cli`,
  `claude_code`).
- `--governance governed` requires `codex_direct` and fails closed for wrapped
  workers.
- `--governance auto` (default) keeps local and staging readiness on
  `codex_cli`; production readiness selects `codex_direct` unless a worker is
  explicitly supplied.

See [docs/worker-selection.md](docs/worker-selection.md) for the full decision
guide and [docs/security-model.md](docs/security-model.md) for the formal
assurance and non-goal statement.

## Quick Start: AI-Coded MVP

Run the end-to-end readiness path in an empty or existing MVP repository:

```bash
runstead startup ready \
  --cwd /path/to/mvp \
  --stage launch \
  --target local \
  --worker codex_direct \
  --governance governed \
  --app-template static-todo \
  --app-type local-first-web
```

This initializes Runstead if needed, generates context and measurement
artifacts, runs the bounded MVP build/repair loop or **skips the worker when the
current app already has fresh verifier evidence** (the "green path"), discovers
and runs verifier commands, executes UI smoke when a dev server is available,
auto-repairs product-gap UI smoke failures within a bounded retry budget, writes
launch and complete-check reports, and returns a target-aware verdict such as
`local_launch_ready` or explicit blockers.

`--app-template static-todo` is the built-in empty-repo scaffold profile for a
local-first todo MVP; omit it for an existing app. The profile declares
app-owned files (`index.html`, `styles.css`, `app.js`, `server.js`,
`scripts/*.js`) so `codex_direct` can classify safe scaffold patches and reuse
one approval grant across many writes — while dependency, secret, `.git`, and
`.runstead/**` paths stay outside that grant.

Add `--interactive` to supplement context and measurement evidence before the
run; add `--guided` to print and persist next-step commands for every blocker.
Add `--force-build` (alias `--repair`) to override the green-path skip and call
the worker anyway.

Preview the same run without executing the worker:

```bash
runstead startup ready \
  --cwd /path/to/mvp \
  --stage launch \
  --target local \
  --plan
```

Generate the repo-local CI workflow and CI summary artifacts:

```bash
runstead startup ready --cwd /path/to/mvp --write-ci
runstead startup ready --cwd /path/to/mvp --stage launch --target local --ci
```

If the run is interrupted, resume the same readiness run:

```bash
runstead startup ready --cwd /path/to/mvp --resume <run-id>
```

Build and serve the local evidence dashboard (read-only by default):

```bash
runstead dashboard serve --cwd /path/to/mvp
```

Enable the **protected local Operator Console API** when you want the dashboard
to approve, deny, resume, run verifiers, or record manual evidence over HTTP:

```bash
runstead dashboard serve --cwd /path/to/mvp --enable-operator-api
```

Runstead prints a single-process session token and CSRF token; both are
required on every mutating request. The server only accepts local addresses
and rejects cross-origin requests.

Compact the local artifact view and identify unreferenced retention candidates:

```bash
runstead startup artifact hygiene --cwd /path/to/mvp --retention-days 30
```

For a repo-local example, run the todo golden path fixture:

```bash
cp -R packages/domain-packs/packs/ai-native-startup/fixtures/tiny-todo /tmp/todo
runstead startup ready --cwd /tmp/todo --stage launch --target local --worker codex_direct
```

See [docs/ai-coded-mvp-readiness.md](docs/ai-coded-mvp-readiness.md) for the
full MVP-to-launch runbook and
[docs/startup-ready-golden-path.md](docs/startup-ready-golden-path.md) for the
todo fixture walkthrough.

## Readiness Extensions

Drop YAML or JSON manifests into `.runstead/extensions/` to add domain-specific
facets, evidence collectors, verifiers, and gates without forking Runstead.
`runstead startup ready` discovers them, compiles them with `@runstead/sdk`,
runs any declared collector `command` through governed local execution, and
applies the resulting evidence requirements to the readiness verdict.

Collector metadata is enforced as policy, not advisory:

- Level 1 wrapped workers reject collectors that are not `safeForWrappedWorkers`
- Collector `qualityTier` must meet the requested target's minimum quality bar
- Staging and production collectors must declare `defaultFreshnessDays`
- Stale-source evidence is excluded from readiness inputs

Copyable manifests for PostHog activation, Vercel deployment, Sentry error
rate, and GitHub Actions CI live under
[docs/examples/extensions](docs/examples/extensions). See
[docs/sdk.md](docs/sdk.md) for the manifest contract and compile API.

## Strict Mode: Codex Direct

Use `codex_direct` when you need each model tool call to be governed:

```bash
runstead agent run \
  --cwd /path/to/mvp \
  --worker codex_direct \
  --mode repair \
  --max-turns 40 \
  --max-tool-calls 100 \
  --max-failed-tool-calls 8 \
  --denied ".git/**" \
  --denied ".runstead/**" \
  --verifier "test=npm test" \
  --verifier "lint=npm run lint" \
  --verifier "typecheck=npm run typecheck" \
  --verifier "build=npm run build" \
  "Repair the MVP contract without adding dependencies."
```

If policy requires approval, decide the request and resume the same task:

```bash
runstead approval list --cwd /path/to/mvp
runstead approval show <approval-id> --cwd /path/to/mvp
runstead approval approve-and-resume <approval-id> --cwd /path/to/mvp
```

`approve-and-resume` approves and re-enters the task in one step. When the
model regenerates an equivalent action after approval, Runstead reuses the
grant by canonical signature or scoped task-bound grant instead of asking
again. Approved pending patches are applied directly without a second model
turn.

For an edit-heavy local MVP run, configure policy deliberately. Keep protected
paths denied, keep dependency and external writes approval-gated, and allow
ordinary workspace source edits only when the repo is trusted and verifier
evidence is required afterward. In scaffolded startup runs, an approved
`codex_direct` patch grant is scoped to the task's app-owned files, which
reduces repeated approvals during the same MVP build loop while keeping
dependency files and protected state strictly gated.

See [docs/codex-direct.md](docs/codex-direct.md) for the worker architecture,
[docs/worker-selection.md](docs/worker-selection.md) for when to use strict
mode, and [docs/security-model.md](docs/security-model.md) for the formal
assurance boundaries.

## Repo Maintenance And CI Repair

Runstead still supports the original repo-maintenance control loop.

Initialize a repository:

```bash
runstead init --cwd /path/to/repo --profile trusted-local --create-default-goal
runstead doctor --cwd /path/to/repo --codex --worker codex_cli
```

Run an inspected local task:

```bash
runstead agent run \
  --cwd /path/to/repo \
  --worker codex_cli \
  --mode read-only \
  "Inspect this repo and summarize the main test commands."
```

Run a scoped edit with verifier evidence:

```bash
runstead agent run \
  --cwd /path/to/repo \
  --worker codex_cli \
  --mode edit \
  --allowed "src/**" \
  --verifier "test=pnpm test" \
  "Fix the failing test with the smallest reasonable change."
```

Repair a CI failure through the governed branch/verifier/PR loop:

```bash
runstead repair-ci <github-actions-run-id> \
  --cwd /path/to/repo \
  --worker codex_cli \
  --allowed "src/**" \
  --verifier "test=pnpm test"
```

Inspect the Runstead record:

```bash
runstead agent report <task-id> --cwd /path/to/repo
runstead audit replay <task-id> --cwd /path/to/repo
runstead audit export --cwd /path/to/repo
```

If a task is stuck in `running` because the original process crashed,
recover it:

```bash
runstead resume --cwd /path/to/repo
```

`resume` finds tasks past their execution lease, fails interrupted worker
runs and tool calls, and either requeues retryable tasks or marks them
failed.

## Evidence And Gates

Runstead treats readiness as evidence-backed state computed by a single
verdict engine in `@runstead/runtime`:

- **MVP gate**: hypotheses, validation/disconfirming evidence, verifier
  results, and agent context.
- **Launch gate**: metric snapshot, repo audit, security baseline, UI evidence,
  migration plan, rollback plan, rollback drill, observability, monitoring
  alerts, error budget, migration validation, traffic gate, release/deployment
  evidence, and owner-backed remediation records.
- **Scale gate**: workflow registry, delegation policy, institutional memory,
  support triage, recurring reports, SOPs, GTM verification, and integration
  depth.
- **Complete product check**: launch report, CI gate, dashboard, diagnostics,
  remediation loop, evidence/event truth, and deployment/release proof.

Evidence is tiered. `--target local` can return `local_launch_ready` from
synthetic UI smoke, manual, and local command evidence. `--target staging`
additionally requires CI-verified, staging deployment, rollback drill,
monitoring alerts, and migration validation. `--target production` requires
production deployment, real-user analytics, support/feedback triage, security
scan, rollback plan, rollback drill, observability, monitoring alerts, error
budget, migration validation, traffic gate, and post-launch watch.

Synthetic smoke evidence is useful but low-confidence by design. Real user
analytics, production deployment checks, support records, and CI runs should
replace synthetic evidence before a real public launch. Use
`runstead startup source verify` to live-fetch external evidence URIs before
recording them.

For staging and production targets, `startup ready --plan` also reports the
required source connector setup for CI, deployment, monitoring, and analytics.
Missing provider credentials are readiness blockers until the relevant
connector evidence can be collected or verified. Provider adapter collection
records malformed, pending, and provider-error payloads as explicit evidence
states, withholds target readiness tiers unless the collected status is
`passed`, and redacts token-like fields before writing artifacts.

## Team Mode (Experimental)

The default product path is local workstations and CI jobs with the bundled
`@runstead/state-sqlite` backend. For shared team deployments,
`@runstead/state-postgres` implements the same `RuntimeControlPlaneBackend`
contract over Postgres:

- atomic event append with `expectedRevision` optimistic concurrency
- idempotency-keyed appends
- database-backed runner registry and heartbeat records
- database-fenced runner leases
- JSONB projections and hash-addressed artifacts
- schema migrations with checksum verification

Both backends are exercised by `@runstead/testkit`'s
`runRuntimeControlPlaneBackendConformance` suite, so SQLite and Postgres
satisfy identical event/lock/artifact semantics.

`createPostgresTeamControlPlaneProfile` produces a
`RuntimeTeamControlPlaneProfile` that passes
`assessTeamControlPlaneReadiness`. A real organization deployment still needs
runner identity, IdP/RBAC, central secret handling, and shared artifact
storage on top of the adapter. See
[docs/security-model.md](docs/security-model.md) for the boundary.

`runstead doctor` now reports the selected runtime backend. SQLite is the
default. Team mode is explicit. Start by generating a checked env template:

```bash
runstead team control-plane bootstrap --cwd /path/to/repo
```

Then run the dedicated team backend check:

```bash
RUNSTEAD_RUNTIME_BACKEND=postgres \
RUNSTEAD_POSTGRES_URL=postgres://runstead/state \
RUNSTEAD_ARTIFACT_BASE_URI=s3://runstead/evidence \
RUNSTEAD_TEAM_ORG_ID=org_123 \
RUNSTEAD_RUNNER_ID=runner_1 \
RUNSTEAD_RUNNER_LAST_SEEN_AT=2026-05-24T00:00:00.000Z \
RUNSTEAD_AUDIT_SINK_URI=s3://runstead/audit \
runstead team control-plane check --cwd /path/to/repo
```

Print the Postgres schema migration SQL for deployment tooling:

```bash
runstead team control-plane migration-sql --schema runstead
```

Record live runner liveness in the shared backend, then inspect the registered
runners:

```bash
RUNSTEAD_RUNTIME_BACKEND=postgres \
RUNSTEAD_POSTGRES_URL=postgres://runstead/state \
RUNSTEAD_TEAM_ORG_ID=org_123 \
RUNSTEAD_TEAM_WORKSPACE_ID=workspace_123 \
runstead team control-plane runner heartbeat \
  --cwd /path/to/repo \
  --runner-id runner_1 \
  --labels runstead,codex_direct \
  --migrate

RUNSTEAD_RUNTIME_BACKEND=postgres \
RUNSTEAD_POSTGRES_URL=postgres://runstead/state \
RUNSTEAD_TEAM_ORG_ID=org_123 \
RUNSTEAD_TEAM_WORKSPACE_ID=workspace_123 \
runstead team control-plane runner list --cwd /path/to/repo
```

The command reports backend selection, Postgres connection string presence,
shared artifact URI, runner identity, fresh runner heartbeat, database lease
fencing, hash-chain audit, OIDC/RBAC, and central secret-store boundaries.
`RUNSTEAD_RUNNER_LAST_SEEN_AT` may be one ISO timestamp applied to all runners
or comma-separated `runner_id=timestamp` entries for static diagnostics. The
runner heartbeat command writes the same liveness signal into Postgres for
team deployments. `runstead doctor` includes the same backend assessment as
part of the broader local health check.

## Setup For This Monorepo

This repository is a pnpm workspace targeting Node.js 24 LTS.

```bash
nvm use
corepack enable pnpm
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Useful development commands:

```bash
pnpm --filter @runstead/cli test
pnpm --filter @runstead/cli lint
pnpm --filter @runstead/cli build
pnpm format:check
```

## Packages

Contract packages (stable surface for extensions and external runtimes):

- `@runstead/core`: shared schemas, IDs, and control-plane contracts
- `@runstead/runtime`: execution semantics, readiness plan/verdict engine,
  storage/lock/artifact backend contracts, team-control-plane contracts, and
  provider-neutral tool-call adapter primitives
- `@runstead/governance`: policy evaluation, action risk scoring, reusable
  governance primitives
- `@runstead/tools`: governed tool action contract registry
- `@runstead/verifiers`: verifier command contracts and result shapes
- `@runstead/evidence`: evidence quality tier and source trust contracts
- `@runstead/workers`: worker capability and governance-level contracts
- `@runstead/sdk`: public extension manifest, validation, and runtime compile
- `@runstead/skills`: skill package lifecycle utilities

Concrete implementations and host surfaces:

- `@runstead/state-sqlite`: default SQLite state-store adapter
- `@runstead/state-postgres`: Postgres team-runtime adapter
- `@runstead/domain-packs`: built-in `repo-maintenance`, `ai-native-startup`,
  `research-monitor`, and `email-followup` packs
- `@runstead/cli`: local command surface, dashboard server, codex-direct
  worker, startup-ready orchestrator
- `@runstead/testkit`: control-plane conformance suite, fixture and temp
  workspace helpers

## Documentation

Product and lifecycle:

- [docs/roadmap.md](docs/roadmap.md): current implementation backlog and
  validation order
- [docs/product-positioning.md](docs/product-positioning.md): product stance
  and boundaries
- [docs/startup-lifecycle.md](docs/startup-lifecycle.md): stage model and
  startup pack shape
- [docs/ai-coded-mvp-readiness.md](docs/ai-coded-mvp-readiness.md): practical
  MVP-to-launch runbook
- [docs/startup-ready-golden-path.md](docs/startup-ready-golden-path.md): todo
  dogfood golden path
- [docs/startup-artifact-hygiene.md](docs/startup-artifact-hygiene.md):
  retention and latest-artifact view
- [docs/research-monitor-golden-path.md](docs/research-monitor-golden-path.md):
  second mature domain pack workflow
- [docs/email-followup-golden-path.md](docs/email-followup-golden-path.md):
  draft-only follow-up domain pack workflow
- [docs/non-startup-domain-golden-paths.md](docs/non-startup-domain-golden-paths.md):
  combined non-startup domain proof

Architecture and governance:

- [docs/architecture.md](docs/architecture.md): package graph and runtime
  boundaries
- [docs/worker-selection.md](docs/worker-selection.md): `codex_cli` vs
  `codex_direct` decision guide
- [docs/codex-direct.md](docs/codex-direct.md): native worker architecture and
  module breakdown
- [docs/security-model.md](docs/security-model.md): assurance levels, trust
  boundaries, approval semantics, team-mode boundary, non-goals
- [docs/policy.md](docs/policy.md): policy DSL, approval grants, scaffold
  patch class
- [docs/verifier.md](docs/verifier.md): verifier evidence model
- [docs/daemon.md](docs/daemon.md): daemon mode, heartbeats, webhook intake
- [docs/skills.md](docs/skills.md): experimental skill package lifecycle

Extension and pack authoring:

- [docs/sdk.md](docs/sdk.md): extension manifest, compile API, loader
  contract
- [docs/domain-packs.md](docs/domain-packs.md): domain pack structure
- [docs/examples/extensions](docs/examples/extensions): copyable extension
  manifests
