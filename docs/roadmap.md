# Runstead Roadmap

Updated: 2026-05-26

This roadmap tracks the current implementation backlog after the latest
architecture, readiness, SDK, operator-console, Postgres, and dogfood work. It
intentionally excludes older items that are already implemented, including
versioned SQLite migrations, atomic approval decisions, execution semantics,
Codex Direct retry, verifier-only recovery, startup-ready module split, Codex
Direct module split, extension loader integration, extension collector policy
metadata, executable operator endpoints, and Postgres backend contracts.

## Current Baseline

Runstead is now a local and CI control plane for AI-coded MVP readiness, not
just an agent wrapper. The current product surface includes:

- target-aware `startup ready` verdicts for local, staging, and production
- durable SQLite state with versioned migrations and query indexes
- Level 1 wrapped workers (`codex_cli`, `claude_code`) and Level 2
  `codex_direct` governed execution
- approval grants with canonical action signatures and scoped reuse
- explicit implementation, verification, and agent-completion semantics
- Codex Direct model retry/backoff and structured interruption diagnostics
- current verifier evidence reuse after recoverable agent completion failures
- UI smoke validation and bounded repair hooks
- SDK extension manifests that can block readiness and execute governed
  collectors
- quality, freshness, and wrapped-worker safety metadata as readiness policy
  inputs
- dashboard snapshots, operator action catalogues, and protected local mutating
  operator endpoints
- `RuntimeControlPlaneBackend` contracts plus SQLite and Postgres backend
  implementations/conformance coverage
- CI package smoke coverage for publishable packages including
  `@runstead/state-postgres`
- runtime backend selection diagnostics for local SQLite and explicit Postgres
  team mode
- provider source evidence collection for GitHub Actions, Vercel, Render,
  Sentry, and PostHog
- wrapped-worker progress summaries with last-output age and
  `possibly_stuck` diagnostics
- dashboard operator UI controls for action execution and approval decisions
- command registration extracted for dashboard, doctor, and startup source
- richer `ai-native-startup`, `research-monitor`, and `email-followup` domain
  packs

## Execution Rules

- Keep one implementation concern per commit.
- Preserve target boundaries: local readiness is not staging or public launch
  clearance.
- Never weaken policy, approval, or evidence gates to make a run green.
- Prefer current evidence and code-state fingerprints over worker summaries.
- Keep `.runstead` output as audit state, not product source.
- Update docs in the same commit when behavior changes.
- Add focused tests for each behavioral change before broad validation.

## Completed In This Wave

The current implementation wave closed the highest-confidence product gaps:

- `docs/roadmap.md` is the tracked roadmap; local ignored `plan.md` remains a
  scratch mirror only.
- CI package smoke now includes `@runstead/state-postgres`.
- `packages/cli/src/index.ts` no longer owns dashboard or doctor command
  registration.
- `packages/cli/src/startup-command.ts` no longer owns startup source command
  registration.
- `@runstead/runtime` exposes backend selection for SQLite and Postgres.
- `runstead doctor` reports backend setup blockers and team readiness.
- Wrapped workers expose progress summary, last output age, and
  `possibly_stuck` diagnostics.
- `startup source collect` records structured provider evidence through
  executable adapters.
- Dashboard operator controls can run actions and approve/deny pending
  approvals through the protected local API.
- `email-followup` now has a mature draft-only lifecycle, fixtures, evals,
  gates, report sections, and docs.

## Remaining Backlog

### 1. Continue splitting long CLI runtime modules

`dashboard.ts`, `ci-repair-orchestrator.ts`, `startup-automation.ts`,
`startup-command.ts`, `local-agent.ts`, and the remaining command groups still
carry too much behavior.

Acceptance:

- Each extraction is behavior-preserving and independently tested.
- Pure contracts move to `runtime`, `governance`, `verifiers`, `tools`, or
  `sdk` when they have no CLI dependency.
- CLI remains the command adapter and local host.

Validation:

```bash
pnpm --filter @runstead/cli lint
pnpm --filter @runstead/cli typecheck
pnpm --filter @runstead/runtime typecheck
```

### 2. Turn team runtime diagnostics into a bootstrap command

Doctor can now assess backend selection, but operators still need a dedicated
bootstrap/check command for Postgres connection, runner id, lock lease, audit
hash chain, artifact base URI, OIDC/RBAC, and secret-store configuration.

Acceptance:

- A team operator can run one diagnostic command and see missing readiness
  assertions.
- The security model continues to state that local SQLite is not a
  multi-tenant security boundary.

Validation:

```bash
pnpm --filter @runstead/cli exec vitest run src/doctor.test.ts
pnpm run format:check
```

### 3. Harden provider adapters beyond offline JSON fixtures

Acceptance:

- Each adapter has documented provider endpoint shapes and credential names.
- Missing credentials become explicit staging/production setup blockers, not
  silent local warnings.
- `startup ready --plan` shows required connector evidence before execution.
- Staging/production targets can require the adapters by policy.

Validation:

```bash
pnpm --filter @runstead/cli exec vitest run src/startup-source-connectors.test.ts src/startup-ready.test.ts
pnpm run typecheck
```

### 4. Deepen operator recovery timeline UX

Dogfood runs often move from blocked to ready through repair or recovery. The
dashboard has action controls and timeline groups; the next step is a richer
explanation of why the final verdict is trustworthy.

Acceptance:

- Latest blocked/interrupted run can be compared with latest ready run.
- Timeline groups phases, worker runs, model requests, tool calls, approvals,
  evidence, reports, and recovery decisions.
- UI smoke artifacts and stale evidence groups are linked from the timeline.

Validation:

```bash
pnpm --filter @runstead/cli exec vitest run src/dashboard.test.ts src/startup-ready.test.ts
```

## Suggested Order

1. Continue CLI module extraction by command/runtime ownership.
2. Add the team-control-plane bootstrap/check command.
3. Connect provider adapters into staging/production readiness planning.
4. Expand operator recovery timeline explanations and action-specific forms.

## Milestone Validation

Run focused tests per item, then a broader gate before a milestone lands:

```bash
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
git diff --check
```

Release validation should use the declared engine in `.node-version`
(`>=24.15 <27`). Older local Node versions may emit engine warnings and should
not be used as final release evidence.
