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
- CI-backed real Postgres integration validation for `@runstead/state-postgres`
- CI package smoke coverage for publishable packages including
  `@runstead/state-postgres`
- runtime backend selection diagnostics for local SQLite and explicit Postgres
  team mode
- provider source evidence collection for GitHub Actions, Vercel, Render,
  Sentry, and PostHog, including defensive status classification and token
  redaction
- staging/production source connector requirements in `startup ready --plan`
  and final readiness verdicts
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
- Top-level core command registration (`init`, `status`, `upgrade`) moved out
  of the CLI entrypoint into `commands/core`.
- Shared CLI RBAC guard moved out of the CLI entrypoint into `cli-rbac`.
- CLI error type and formatting moved out of the CLI entrypoint into
  `cli-errors`.
- Shared unmanaged-helper acknowledgement moved out of the CLI entrypoint into
  `cli-unmanaged`.
- Shared CLI positive integer parser moved out of the CLI entrypoint into
  `cli-parsers`.
- Shared optional/required integer parsers moved out of the CLI entrypoint into
  `cli-parsers`.
- Shared date option parser moved out of the CLI entrypoint into `cli-parsers`.
- Shared optional float parser moved out of the CLI entrypoint into
  `cli-parsers`.
- Shared repeated-option value collector moved out of the CLI entrypoint into
  `cli-parsers`.
- Shared worker-kind parser moved out of the CLI entrypoint into `cli-parsers`.
- Top-level `resume` command registration moved out of the CLI entrypoint into
  `commands/resume`.
- `ops diagnostics` command registration moved out of the CLI entrypoint into
  `commands/ops`.
- `checkpoint restore` command registration moved out of the CLI entrypoint into
  `commands/checkpoint`.
- Top-level `migrate` command registration moved out of the CLI entrypoint into
  `commands/migrate`.
- Top-level `run --once` command registration moved out of the CLI entrypoint
  into `commands/run`.
- Top-level `daemon` command registration moved out of the CLI entrypoint into
  `commands/daemon`.
- `scheduler tick` command registration moved out of the CLI entrypoint into
  `commands/scheduler`.
- `rbac` command registration moved out of the CLI entrypoint into
  `commands/rbac`.
- `team-policy` command registration moved out of the CLI entrypoint into
  `commands/team-policy`.
- `audit` command registration moved out of the CLI entrypoint into
  `commands/audit`.
- `report` command registration moved out of the CLI entrypoint into
  `commands/report`.
- Shared verifier command option parsing moved out of the CLI entrypoint into
  `verifier-command-options`.
- Shared GitHub App auth token resolution moved out of the CLI entrypoint into
  `github-auth-token`.
- `webhook serve` command registration moved out of the CLI entrypoint into
  `commands/webhook`.
- `memory` command registration moved out of the CLI entrypoint into
  `commands/memory`.
- `skill` command registration moved out of the CLI entrypoint into
  `commands/skill`.
- `repo` command registration moved out of the CLI entrypoint into
  `commands/repo`.
- `domain` command registration moved out of the CLI entrypoint into
  `commands/domain`.
- `goal` command registration moved out of the CLI entrypoint into
  `commands/goal`.
- `task` command registration moved out of the CLI entrypoint into
  `commands/task`.
- `approval` command registration and approval-display helpers moved out of
  the CLI entrypoint into `commands/approval`.
- `verifier` command registration moved out of the CLI entrypoint into
  `commands/verifier`.
- `git` command registration moved out of the CLI entrypoint into
  `commands/git`.
- `policy` command registration moved out of the CLI entrypoint into
  `commands/policy`.
- `config` command registration moved out of the CLI entrypoint into
  `commands/config`.
- `codex` command registration moved out of the CLI entrypoint into
  `commands/codex`.
- Shared secret-print acknowledgement moved out of the CLI entrypoint into
  `cli-secrets`.
- `github` command registration moved out of the CLI entrypoint into
  `commands/github`.
- Shared required verifier command validation moved out of the CLI entrypoint
  into `verifier-command-options`.
- Top-level `repair-ci` command registration moved out of the CLI entrypoint
  into `commands/ci-repair`, and GitHub repair orchestration now reuses that
  command module directly.
- Top-level `agent` command registration and local-agent CLI option helpers
  moved out of the CLI entrypoint into `commands/agent`.
- Agent provider listing moved out of the agent command adapter into
  `commands/agent-providers`.
- Agent inspect subcommand and depth-to-preset parsing moved out of the agent
  command adapter into `commands/agent-inspect`.
- Agent fix and repair-test subcommands moved out of the agent command adapter
  into `commands/agent-fix`.
- Local-agent lifecycle subcommands (`report`, `resume`, `undo`) moved out of
  the agent command adapter into `commands/agent-lifecycle`.
- Agent review subcommand and diff-scope parsing moved out of the agent command
  adapter into `commands/agent-review`.
- Agent test triage subcommand moved out of the agent command adapter into
  `commands/agent-test`.
- Local-agent verifier option resolution moved out of the agent command adapter
  into `local-agent-verifier-options`.
- `packages/cli/src/index.ts` no longer owns dashboard or doctor command
  registration.
- Dashboard snapshot and operator API contracts moved out of the dashboard
  server/rendering module into `dashboard-types`.
- Dashboard audit event payload generation moved out of the dashboard
  server/rendering module into `dashboard-event-payload`.
- Dashboard operator API HTTP/auth helpers moved out of the dashboard
  server/rendering module into `dashboard-operator-api-http`.
- Dashboard operator action routing and execution moved out of the dashboard
  server/rendering module into `dashboard-operator-api-actions`.
- Dashboard operator console action construction moved out of the dashboard
  server/rendering module into `dashboard-operator-console`.
- Dashboard startup readiness-run snapshot parsing moved out of the dashboard
  server/rendering module into `dashboard-startup-runs`.
- Dashboard SQLite row-to-view-model mappers moved out of the dashboard
  server/rendering module into `dashboard-row-mappers`.
- Dashboard daemon status and heartbeat health parsing moved out of the
  dashboard server/rendering module into `dashboard-daemon-status`.
- Dashboard base snapshot and summary SQL queries moved out of the dashboard
  server/rendering module into `dashboard-snapshot`.
- Dashboard startup recovery comparison, timeline groups, and latest agent
  patch audit helpers moved out of the dashboard server/rendering module into
  `dashboard-startup-timeline`.
- Dashboard HTML rendering moved out of the dashboard server/orchestration
  module into `dashboard-render`.
- Local agent task input parsing moved out of the orchestrator into
  `local-agent-task-input`.
- Local agent task reporting, report formatting, and audit-summary loading
  moved out of the orchestrator into `local-agent-report`.
- Local agent prompt, scope, approval, and verifier-evidence input helpers moved
  out of the orchestrator into `local-agent-prompt`.
- CI repair orchestrator public option/result contracts moved into
  `ci-repair-orchestrator-types`.
- CI repair progress stage ordering moved into `ci-repair-orchestrator-stage`.
- CI repair governed action-envelope builders moved out of the orchestrator
  into `ci-repair-orchestrator-actions`.
- CI repair worker-result serialization, redaction, and Codex Direct result
  guards moved out of the orchestrator into
  `ci-repair-orchestrator-worker-output`.
- CI repair checkpoint, git, diff-scope, publish coverage, and pull-request
  output serializers moved out of the orchestrator into
  `ci-repair-orchestrator-output`.
- CI repair report formatting, pull-request body construction, and pull-request
  audit-summary query logic moved out of the orchestrator into
  `ci-repair-orchestrator-report`.
- CI repair stage context, resume context, publish coverage, and retry-counter
  helpers moved out of the orchestrator into `ci-repair-orchestrator-context`.
- CI repair task output projection, terminal task handling, and task event
  helpers moved out of the orchestrator into `ci-repair-orchestrator-task-state`.
- CI repair wrapped-worker/Codex Direct invocation and checkpoint rollback logic
  moved out of the orchestrator into `ci-repair-orchestrator-worker-run`.
- CI repair publish approval, covered git push, and GitHub pull-request
  creation helpers moved out of the orchestrator into `ci-repair-orchestrator-publish`.
- CI repair pull-request resume discovery, running-worker guard, and resume
  intake reconstruction moved out of the orchestrator into
  `ci-repair-orchestrator-resume`.
- Startup workspace hygiene helpers for protected path, environment file,
  dependency file, and path-existence checks moved out of `startup-automation`
  into `startup-workspace-hygiene`.
- Startup structured artifact writing, stable generated-at reuse, artifact path
  helpers, and write-if-changed behavior moved from `startup-automation` into
  `startup-artifacts`.
- Startup evidence summary rows, recent evidence formatting, and support
  category aggregation moved out of `startup-automation` into
  `startup-evidence-summary`.
- Startup repo readiness and launch security blocker/warning evaluation moved
  out of `startup-automation` into `startup-readiness-gates`.
- Startup automation public option/result contracts moved into
  `startup-automation-types`.
- Startup launch security scanning moved out of `startup-automation` into
  `startup-security-scan`.
- Startup command parser helpers moved into `startup-command-parsers` with
  focused unit coverage.
- `packages/cli/src/startup-command.ts` no longer owns startup source command
  registration.
- `packages/cli/src/startup-command.ts` no longer owns startup artifact
  list/show/hygiene command registration.
- `packages/cli/src/startup-command.ts` no longer owns startup gate
  check/test/waive/decide command registration.
- `packages/cli/src/startup-command.ts` no longer owns startup CI summary
  command registration.
- `packages/cli/src/startup-command.ts` no longer owns startup API snapshot
  command registration.
- `packages/cli/src/startup-command.ts` no longer owns startup assess command
  registration.
- `packages/cli/src/startup-command.ts` no longer owns startup ready command
  registration.
- `packages/cli/src/startup-command.ts` no longer owns startup founder shortcut
  command registration.
- `packages/cli/src/startup-command.ts` no longer owns startup context generate
  command registration.
- `packages/cli/src/startup-command.ts` no longer owns startup measurement
  generate/snapshot/assess command registration.
- `packages/cli/src/startup-command.ts` no longer owns startup team digest
  command registration.
- `packages/cli/src/startup-command.ts` no longer owns startup launch
  audit/security/report/support/git/UI/bottleneck command registration.
- Startup automation markdown and metric formatting helpers moved out of
  `startup-automation` into `startup-automation-format`.
- Startup UI smoke default browser runner moved out of `startup-ui-validation`
  into `startup-ui-browser-runner`.
- Startup UI smoke asset persistence moved out of `startup-ui-validation` into
  `startup-ui-validation-assets`.
- Launch readiness protected path git scanning moved out of
  `launch-readiness-report` into `launch-readiness-git`.
- Launch readiness SQL row contracts and data loading moved out of
  `launch-readiness-report` into `launch-readiness-data`.
- `packages/cli/src/startup-command.ts` no longer owns startup scale
  starter/workflow/memory/integration/report/SOP/GTM command registration.
- `packages/cli/src/startup-command.ts` no longer owns startup hypothesis
  command registration.
- `packages/cli/src/startup-command.ts` no longer owns startup evidence
  customer/competitor/add/manual-change command registration.
- `packages/cli/src/startup-command.ts` no longer owns startup complete-check
  command registration.
- `packages/cli/src/startup-command.ts` no longer owns startup remediate
  command registration.
- `packages/cli/src/startup-command.ts` no longer owns startup init/status
  command registration.
- `@runstead/runtime` exposes backend selection for SQLite and Postgres.
- `runstead doctor` reports backend setup blockers and team readiness.
- Wrapped workers expose progress summary, last output age, and
  `possibly_stuck` diagnostics.
- Wrapped-worker stuck progress coverage is stabilized against short timing
  windows in full-suite runs.
- `startup source collect` records structured provider evidence through
  executable adapters.
- Provider adapters classify success, failure, pending, malformed, and
  provider-error payloads while redacting token-like response fields before
  evidence is persisted.
- `startup ready --plan` and final readiness evaluation now consume
  staging/production source connector setup requirements.
- Dashboard operator controls can run actions and approve/deny pending
  approvals through the protected local API.
- Dashboard recovery timelines now link resolved blockers to the ready run
  phase, evidence ids, and artifacts that cleared them.
- Dashboard operator console includes action-specific forms for verifier runs
  and manual evidence recording through the protected local API.
- `email-followup` now has a mature draft-only lifecycle, fixtures, evals,
  gates, report sections, and docs.
- Non-startup golden paths are covered by a combined runbook and CLI/domain
  maturity regression tests for `research-monitor` and `email-followup`.
- `runstead team control-plane bootstrap/check` gives operators a dedicated
  team backend assertion surface.
- CI runs `@runstead/state-postgres` against a real Postgres service via
  `RUNSTEAD_PG_TEST_URL`; local runs skip this integration path unless the env
  var is set.

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

## Suggested Order

1. Continue CLI module extraction by command/runtime ownership.

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
