# Runstead

Runstead is the control plane for AI-coded products that need evidence,
measurement, gates, and audit trails before they are treated as ready.

Coding agents execute. Runstead governs the work around them: goals, policies,
checkpoints, dependency boundaries, verifiers, launch evidence, stage gates,
reports, and resume paths.

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
- records command output, browser/UI, deployment, analytics, support, security,
  and decision evidence
- checks MVP, launch, scale, and complete-product gates
- produces markdown/JSON reports, dashboards, diagnostics, and audit trails

Runstead is not a replacement for Codex CLI, Claude Code, CI, deployment
platforms, or analytics. It is the control plane that makes their output
bounded, evidenced, auditable, and resumable.

## Recommended Default

Use **Runstead + `codex_cli`** as the default local product-building workflow.

`codex_cli` is the practical path for most users today: it keeps the normal
Codex CLI runtime, login session, MCP servers, plugins, and local ecosystem.
Runstead wraps that worker with checkpoints, policy, dependency boundaries,
verifier evidence, stage gates, and launch reports.

Use **Runstead + `codex_direct`** when you need strict governance: every exposed
model tool call is routed through Runstead-native policy and audit before it
executes. This is stronger but heavier; it may require explicit approval rules,
larger turn budgets, and narrower repair tasks.

| Mode           | Best for                                                         | Governance                                                                                                 | Tradeoff                                                 |
| -------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `codex_cli`    | Default MVP build, normal local coding, practical speed          | Level 1 wrapped worker: gated launch, checkpoint, post-run verifier evidence, audit                        | Worker-internal tool calls are not hard-proxied          |
| `codex_direct` | Strict audit, protected workspaces, compliance-sensitive changes | Level 2 native proxy: filesystem, shell, git, verifier, and evidence tool calls go through Runstead policy | Heavier approval/policy setup and smaller tool ecosystem |
| `claude_code`  | Teams standardized on Claude Code CLI                            | Level 1 wrapped worker                                                                                     | Same wrapped-worker boundary as `codex_cli`              |

See [docs/worker-selection.md](docs/worker-selection.md) for the full decision
guide.

## Quick Start: AI-Coded MVP

Initialize an empty or existing MVP repository:

```bash
runstead startup onboard \
  --cwd /path/to/mvp \
  --write-ci
```

Build or repair the MVP with the recommended default worker:

```bash
runstead startup build-mvp \
  --cwd /path/to/mvp \
  --worker codex_cli \
  --dependency-policy deny-new \
  --prompt "Build a polished local-first MVP and satisfy npm test, lint, typecheck, and build."
```

Run the MVP verifier task if you need to reattach current command evidence:

```bash
runstead task list --cwd /path/to/mvp
runstead verifier run <run_mvp_verifiers-task-id> --cwd /path/to/mvp
```

Record UI evidence from a local preview:

```bash
runstead startup launch ui-validate \
  --cwd /path/to/mvp \
  --execute \
  --server-command "npm run dev" \
  --server-port 3000 \
  --url http://127.0.0.1:3000 \
  --expect-text "Dashboard" \
  --flow "primary activation flow" \
  --flow-status pass
```

Record a synthetic launch metric when no real user analytics exists yet:

```bash
runstead startup measurement snapshot \
  --cwd /path/to/mvp \
  --metric activation_flow_completion \
  --source "local browser smoke" \
  --source-uri http://127.0.0.1:3000 \
  --source-kind browser_ui \
  --source-class synthetic_smoke \
  --confidence 0.55 \
  --threshold 1 \
  --current 1 \
  --unit flow \
  --window local-smoke \
  --cohort local-founder-qa \
  --trend flat \
  --false-positive "Synthetic smoke is not real-user demand evidence."
```

Check gates and generate reports:

```bash
runstead startup gate check --cwd /path/to/mvp --stage mvp
runstead startup launch-check --cwd /path/to/mvp
runstead startup gate check --cwd /path/to/mvp --stage scale
runstead startup launch report --cwd /path/to/mvp --print
runstead startup complete-check --cwd /path/to/mvp --print
```

See [docs/ai-coded-mvp-readiness.md](docs/ai-coded-mvp-readiness.md) for the
full MVP-to-launch runbook.

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
runstead approval approve <approval-id> --cwd /path/to/mvp
runstead agent resume <task-id> --cwd /path/to/mvp
```

For an edit-heavy local MVP run, configure policy deliberately. Keep protected
paths denied, keep dependency and external writes approval-gated, and allow
ordinary workspace source edits only when the repo is trusted and verifier
evidence is required afterward.

See [docs/codex-direct.md](docs/codex-direct.md) for architecture and
[docs/worker-selection.md](docs/worker-selection.md) for when to use strict
mode.

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

## Evidence And Gates

Runstead treats readiness as evidence-backed state:

- **MVP gate**: hypotheses, validation/disconfirming evidence, verifier
  results, and agent context.
- **Launch gate**: metric snapshot, repo audit, security baseline, UI evidence,
  migration plan, rollback plan, observability, release/deployment evidence,
  and owner-backed remediation records.
- **Scale gate**: workflow registry, delegation policy, institutional memory,
  support triage, recurring reports, SOPs, GTM verification, and integration
  depth.
- **Complete product check**: launch report, CI gate, dashboard, diagnostics,
  remediation loop, evidence/event truth, and deployment/release proof.

Synthetic smoke evidence is useful but low-confidence by design. Real user
analytics, production deployment checks, support records, and CI runs should
replace synthetic evidence before a real public launch.

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

- `@runstead/cli`: command-line interface
- `@runstead/core`: domain-agnostic control-plane contracts
- `@runstead/state-sqlite`: SQLite state store
- `@runstead/domain-packs`: built-in domain packs
- `@runstead/testkit`: test helpers and fixture utilities

## Documentation

- [docs/ai-coded-mvp-readiness.md](docs/ai-coded-mvp-readiness.md): practical
  MVP-to-launch runbook
- [docs/worker-selection.md](docs/worker-selection.md): `codex_cli` vs
  `codex_direct` decision guide
- [docs/product-positioning.md](docs/product-positioning.md): product stance
  and boundaries
- [docs/startup-lifecycle.md](docs/startup-lifecycle.md): stage model and
  startup pack shape
- [docs/codex-direct.md](docs/codex-direct.md): native worker architecture and
  strict governance notes
- [docs/policy.md](docs/policy.md): policy and approval model
- [docs/verifier.md](docs/verifier.md): verifier evidence model
- [docs/domain-packs.md](docs/domain-packs.md): domain pack structure
