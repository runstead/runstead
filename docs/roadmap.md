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
- richer `ai-native-startup` and `research-monitor` domain packs

## Execution Rules

- Keep one implementation concern per commit.
- Preserve target boundaries: local readiness is not staging or public launch
  clearance.
- Never weaken policy, approval, or evidence gates to make a run green.
- Prefer current evidence and code-state fingerprints over worker summaries.
- Keep `.runstead` output as audit state, not product source.
- Update docs in the same commit when behavior changes.
- Add focused tests for each behavioral change before broad validation.

## P0 - Keep Product Truth Complete

### 1. Keep CI and release packaging complete

CI is the public proof that every publishable package builds, tests, and packs.
`@runstead/state-postgres` is now part of the team-runtime story and must stay
inside package smoke.

Acceptance:

- CI dry-runs package creation for every publishable workspace package.
- Private/internal packages remain out of public package smoke unless
  intentionally released.
- Future package omissions are easy to spot from the workflow structure.

Validation:

```bash
pnpm --filter @runstead/state-postgres pack --dry-run
pnpm run format:check
```

### 2. Keep roadmap documents aligned with shipped behavior

The roadmap is used as an implementation contract. Completed P0/P1 items belong
in the current baseline, not the active backlog.

Acceptance:

- Active roadmap items describe current gaps only.
- Each active item maps to concrete files, tests, or commands.

Validation:

```bash
rg -n "Current state:|already defines|still mostly|about 3900|about 3776" docs/roadmap.md
```

## P1 - Reduce CLI Structural Risk

### 3. Extract command registration from `packages/cli/src/index.ts`

`index.ts` remains one of the largest files in the repo. New command groups
should not keep increasing its ownership.

Implement:

- Move command registration into focused modules under
  `packages/cli/src/commands/`.
- Start with low-risk groups such as dashboard, doctor, startup source, and
  agent run.
- Keep `index.ts` as the binary entrypoint, option parsing coordinator, and
  compatibility export surface.

Acceptance:

- `index.ts` no longer owns each command group's full action body.
- Existing command help output remains stable.
- Command tests pass without broad fixture rewrites.

Validation:

```bash
pnpm --filter @runstead/cli exec vitest run src/index.test.ts src/dashboard.test.ts src/doctor.test.ts
pnpm --filter @runstead/cli typecheck
```

### 4. Split long CLI runtime modules by ownership

`dashboard.ts`, `ci-repair-orchestrator.ts`, `startup-automation.ts`,
`startup-command.ts`, and `local-agent.ts` still carry too much behavior.

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

## P1 - Make Team Runtime Usable

### 5. Add runtime backend selection

SQLite is correct for local and CI. Postgres backend contracts exist, but users
need an intentional runtime path for team control-plane mode.

Acceptance:

- Runtime config can resolve `sqlite` or `postgres`.
- SQLite remains the default.
- Missing Postgres configuration produces precise setup guidance.
- `runstead doctor` can report whether the selected backend satisfies team
  control-plane requirements.

Validation:

```bash
pnpm --filter @runstead/runtime test
pnpm --filter @runstead/state-postgres test
pnpm --filter @runstead/cli exec vitest run src/doctor.test.ts
```

### 6. Add a team-control-plane bootstrap path

Operators need a repeatable setup path for Postgres connection, runner id, lock
lease, audit hash chain, artifact base URI, OIDC/RBAC, and secret-store
configuration.

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

## P2 - Deepen Production Evidence Connectors

### 7. Promote startup source connectors into executable adapters

Startup source connectors can record and verify evidence, but production systems
still need stronger adapter contracts.

Acceptance:

- A connector can collect structured evidence through a governed action path.
- Missing credentials become explicit staging/production setup blockers, not
  silent local warnings.
- Offline fixture adapters continue to support tests and demos.

Validation:

```bash
pnpm --filter @runstead/cli exec vitest run src/startup-source-connectors.test.ts
pnpm --filter @runstead/sdk test
```

### 8. Ship first real provider adapters

Implement first:

- GitHub Actions workflow conclusion evidence
- Vercel or Render deployment status evidence
- Sentry release/error blocker evidence
- PostHog activation metric evidence

Acceptance:

- Each adapter has an offline fixture test and documented environment contract.
- `startup ready --plan` shows required connector evidence before execution.
- Staging/production targets can require the adapters by policy.

Validation:

```bash
pnpm --filter @runstead/cli exec vitest run src/startup-source-connectors.test.ts src/startup-ready.test.ts
pnpm run typecheck
```

## P2 - Improve Operator Experience

### 9. Turn operator actions into first-class UI controls

The protected operator API exists, but the dashboard should let an operator
resolve common local blocked runs without copying terminal commands.

Acceptance:

- UI controls exist for approve/deny, resume, rerun verifiers, run recovery, and
  record manual evidence.
- Mutating API remains disabled by default.
- Every mutation still requires session token, CSRF token, same-origin checks,
  and audit events.

Validation:

```bash
pnpm --filter @runstead/cli exec vitest run src/dashboard.test.ts
```

### 10. Add run comparison and recovery timelines

Dogfood runs often move from blocked to ready through repair or recovery. The
dashboard should explain why the final verdict is trustworthy.

Acceptance:

- Latest blocked/interrupted run can be compared with latest ready run.
- Timeline groups phases, worker runs, model requests, tool calls, approvals,
  evidence, reports, and recovery decisions.
- UI smoke artifacts and stale evidence groups are linked from the timeline.

Validation:

```bash
pnpm --filter @runstead/cli exec vitest run src/dashboard.test.ts src/startup-ready.test.ts
```

## P2 - Improve Wrapped-Worker Observability

### 11. Add `codex_cli` progress heartbeat and stuck detection

Wrapped workers are intentionally weaker governance boundaries. Operators still
need to know whether a long `codex_cli` run is active, silent, or likely stuck.

Acceptance:

- Wrapped-worker runs record heartbeat events while the child process is alive.
- Dashboard and CLI show child process age, last output age, and a
  `possibly_stuck` warning after a configurable silence window.
- Documentation remains honest that this is observability, not hard proof of
  internal tool behavior.

Validation:

```bash
pnpm --filter @runstead/cli exec vitest run src/wrapped-worker.test.ts src/local-agent.test.ts
```

## P3 - Domain Pack Depth

### 12. Bring `email-followup` to real pack parity

`ai-native-startup` is rich and `research-monitor` is credible. A third mature
pack would better prove the domain-pack abstraction.

Acceptance:

- `email-followup` has mature task types, evidence gates, policy, verifier
  expectations, fixtures, and golden-path docs.
- Pack validation tests cover the mature shape.

Validation:

```bash
pnpm --filter @runstead/domain-packs test
pnpm run format:check
```

## Suggested Order

1. CI package smoke completeness.
2. Roadmap alignment.
3. First command-registration extraction from `index.ts`.
4. Backend selection and team bootstrap diagnostics.
5. Wrapped-worker observability for `codex_cli` dogfood.
6. Production connector adapter path.
7. Executable dashboard UX and recovery timeline.
8. Mature `email-followup`.

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
