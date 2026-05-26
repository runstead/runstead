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
- extension collector `outputSchema` validation before evidence is recorded
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
- Approval grant action-id, canonical-signature, and scoped-grant matching
  moved out of `approvals` into `approval-grant-match`.
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
- Codex auth store path, cache path, auth-file IO, and auth lock helpers moved
  out of `codex-auth` into `codex-auth-store`.
- Codex JWT expiry and ChatGPT account header helpers moved out of
  `codex-auth` into `codex-auth-token`.
- Codex auth status and model-list rendering moved out of `codex-auth` into
  `codex-auth-format`.
- Codex auth provider constants and payload parsing/normalization helpers moved
  out of `codex-auth` into `codex-auth-constants` and `codex-auth-parsers`.
- Codex OAuth device-code polling, authorization-code exchange, and token
  refresh calls moved out of `codex-auth` into `codex-auth-oauth`.
- Doctor state database schema and runtime backend checks moved out of `doctor`
  into `doctor-runtime-checks`.
- Doctor workspace health checks for files, directories, domain manifests,
  daemon heartbeat, RBAC/team policy, GitHub App config, and runtime artifact
  ignores moved out of `doctor` into `doctor-workspace-checks`.
- Launch readiness Markdown formatting and source/risk helper rendering moved
  out of `launch-readiness-report` into `launch-readiness-report-format`.
- Launch readiness blocker source and risk-register rendering moved out of
  `launch-readiness-report-format` into `launch-readiness-risk-format`.
- Shared secret-print acknowledgement moved out of the CLI entrypoint into
  `cli-secrets`.
- `github` command registration moved out of the CLI entrypoint into
  `commands/github`.
- Shared required verifier command validation moved out of the CLI entrypoint
  into `verifier-command-options`.
- Approval action metadata parsing moved out of `approvals` into
  `approval-action-metadata`.
- Approval row mapping, pending-approval lookup, policy-decision lookup, and
  task lookup moved out of `approvals` into `approval-rows`.
- Approval request, expiration, decision event, payload, and projection
  transition builders moved out of `approvals` into `approval-transitions`.
- Approval grant lookup, reuse classification, and expiration writes moved out
  of `approvals` into `approval-grants`.
- Top-level `repair-ci` command registration moved out of the CLI entrypoint
  into `commands/ci-repair`, and GitHub repair orchestration now reuses that
  command module directly.
- CI repair workflow failure classification moved out of `ci-repair` into
  `ci-repair-classification`.
- CI repair workflow-run repairability and webhook-id detection moved out of
  `ci-repair` into `ci-repair-workflow-run`.
- CI repair duplicate-intake existing-task lookup and artifact reload helpers
  moved out of `ci-repair` into `ci-repair-existing-task`.
- CI repair workflow-run evidence artifact writing moved out of `ci-repair`
  into `ci-repair-evidence`.
- CI repair GitHub workflow log redaction moved out of `ci-repair` into
  `ci-repair-log-redaction`.
- CI repair GitHub governed action builders moved out of `ci-repair` into
  `ci-repair-actions`.
- CI repair task report formatting moved out of `ci-repair` into
  `ci-repair-report`.
- Startup CI summary, PR comment, check-run, and remote-Actions rendering moved
  out of `startup-ci-integration` into `startup-ci-format`.
- Startup GitHub Actions remote status inspection and failed-job log excerpts
  moved out of `startup-ci-integration` into `startup-ci-github-actions`.
- Startup scale Markdown formatters moved out of `startup-automation-format`
  into `startup-scale-format`.
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
- Local agent preset override loading and YAML parsing moved out of
  `local-agent-presets` into `local-agent-preset-overrides`.
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
- Dashboard static CSS and operator-console browser script moved out of
  `dashboard-render` into `dashboard-render-assets`.
- Chrome DevTools Protocol connection handling moved out of the startup UI
  browser runner into `startup-ui-cdp-connection`.
- Chrome DevTools executable discovery, websocket startup, and profile cleanup
  moved out of the startup UI browser runner into `startup-ui-chrome-devtools`.
- Chrome DevTools Protocol UI flow action script generation moved out of the
  startup UI browser runner into `startup-ui-cdp-flow-action`.
- Playwright UI overlap geometry checks moved out of the startup UI browser
  runner into `startup-ui-playwright-overlap`.
- Local agent task input parsing moved out of the orchestrator into
  `local-agent-task-input`.
- Local agent task reporting, report formatting, and audit-summary loading
  moved out of the orchestrator into `local-agent-report`.
- Local agent report section construction moved out of `local-agent-report`
  into `local-agent-report-sections`.
- Local agent prompt, scope, approval, and verifier-evidence input helpers moved
  out of the orchestrator into `local-agent-prompt`.
- Local agent resume-target resolution and approved pending-patch lookup moved
  out of the orchestrator into `local-agent-resume`.
- Local agent checkpoint creation governed action moved out of the orchestrator
  into `local-agent-checkpoint`.
- Local agent goal/task creation and creation-event projection moved out of the
  orchestrator into `local-agent-task-create`.
- Local agent verifier evidence attachment and post-worker verifier execution
  moved out of the orchestrator into `local-agent-verifier-run`.
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
- CI repair branch creation and checkpoint workspace preparation moved out of
  the orchestrator into `ci-repair-orchestrator-workspace`.
- CI repair post-worker git status, commit, diff-scope verification, verifier
  execution, and rollback-on-failure logic moved into
  `ci-repair-orchestrator-verification`.
- CI repair approval summary, durable approval record, and publish approval
  stage mapping helpers moved out of the orchestrator into
  `ci-repair-orchestrator-approval`.
- CI repair publish approval, covered git push, and GitHub pull-request
  creation helpers moved out of the orchestrator into `ci-repair-orchestrator-publish`.
- CI repair publish execution, approval waits, denied sub-action handling, and
  publish failure finalization moved into `ci-repair-orchestrator-publish-flow`.
- CI repair pull-request resume discovery, running-worker guard, and resume
  intake reconstruction moved out of the orchestrator into
  `ci-repair-orchestrator-resume`.
- CI repair pull-request resume execution moved out of the orchestrator and
  into `ci-repair-orchestrator-resume`.
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
- Startup automation initialization helpers moved out of `startup-automation`
  into `startup-automation-init`.
- Startup launch security scanning moved out of `startup-automation` into
  `startup-security-scan`.
- Startup scale, support, memory, integration, SOP, GTM, and recurring ops
  artifact generation moved out of `startup-automation` into
  `startup-scale-automation`.
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
- Startup UI smoke browser retry and infrastructure error classification moved
  out of `startup-ui-validation` into `startup-ui-validation-retry`.
- Startup ready UI smoke todo-flow inference and scaffold layout actions moved
  out of `startup-ready-ui-smoke` into `startup-ready-ui-smoke-flow`.
- Launch readiness protected path git scanning moved out of
  `launch-readiness-report` into `launch-readiness-git`.
- Launch readiness SQL row contracts and data loading moved out of
  `launch-readiness-report` into `launch-readiness-data`.
- Launch readiness evidence freshness, currentness, and provenance helpers moved
  out of `launch-readiness-report` into `launch-readiness-evidence`.
- Launch readiness trust summary scoring and trend analysis moved out of
  `launch-readiness-report` into `launch-readiness-trust`.
- Launch readiness public option, result, target, and target-status contracts
  moved out of `launch-readiness-report` into `launch-readiness-types`.
- Launch readiness target-status mapping and release blocker evaluation moved
  out of `launch-readiness-report` into `launch-readiness-decision`.
- Launch readiness previous-report lookup and report event payload construction
  moved out of `launch-readiness-report` into `launch-readiness-events`.
- Launch readiness JSON audit export construction moved out of
  `launch-readiness-report` into `launch-readiness-audit-export`.
- Startup evidence source normalization and provenance helpers moved out of
  `startup-evidence` into `startup-evidence-sources`.
- Startup evidence type constants and validation helpers moved out of
  `startup-evidence` into `startup-evidence-types`.
- Startup source connector definitions and provider adapter registry moved out
  of `startup-source-connectors` into `startup-source-connector-definitions`.
- Startup source provider response parsing, status classification, auth headers,
  and redaction moved out of `startup-source-connectors` into
  `startup-source-provider-payload`.
- Startup source target readiness requirements and evidence requirement mapping
  moved out of `startup-source-connectors` into
  `startup-source-readiness-requirements`.
- Startup source evidence content, target tier mapping, payload parsing, payload
  warnings, and trust parsing moved out of `startup-source-connectors` into
  `startup-source-evidence-content`.
- Codex Direct package script and verifier-candidate inspection moved out of
  `codex-direct-native-tools` into `codex-direct-package-scripts`.
- Codex Direct apply-patch parsing and hunk application moved out of
  `codex-direct-native-tools` into `codex-direct-apply-patch`.
- Codex Direct workspace glob matching, normalized path handling, root-escape
  checks, symlink traversal checks, and bounded result helpers moved out of
  `codex-direct-native-tools` into `codex-direct-workspace-paths`.
- Codex Direct unified diff touched-file parsing moved out of
  `codex-direct-native-tools` into `codex-direct-unified-diff`.
- Codex Direct text-search matcher, context-line, and preview formatting helpers
  moved out of `codex-direct-native-tools` into `codex-direct-search-text`.
- Codex Direct workspace entry types, directory summary, dirent/stat mapping,
  sorted directory reads, and binary-file probing moved out of
  `codex-direct-native-tools` into `codex-direct-workspace-entries`.
- Codex Direct workspace patch application, touched-file inference, and
  structured replacement helpers moved out of `codex-direct-native-tools` into
  `codex-direct-workspace-patch`.
- Codex Direct governed workspace read tools for package scripts, file info,
  tree, multi-file reads, search, and file listing moved out of
  `codex-direct/governed-tools` into `codex-direct/workspace-read-tools`.
- Codex Direct governed git read tools for diff summaries, log, show, and raw
  status/diff reads moved out of `codex-direct/governed-tools` into
  `codex-direct/git-read-tools`.
- Local agent result semantics, worker output serialization, and governance
  report helpers moved out of `local-agent` into `local-agent-result`.
- Local agent public task, run, resume, undo, and result contracts moved out of
  `local-agent` into `local-agent-types`.
- Local agent governed worker-start, checkpoint action envelopes, checkpoint
  output, and event builders moved out of `local-agent` into
  `local-agent-actions`.
- Local agent run, undo, exit-code, and diagnostic report formatting moved out
  of `local-agent` into `local-agent-run-report`.
- Local agent worker invocation for Codex Direct, approved pending-patch resume,
  and wrapped workers moved out of `local-agent` into `local-agent-worker-run`.
- Startup remediation blocker guidance, prioritization, deduplication, evidence
  expectations, and next-command helpers moved out of `startup-remediation` into
  `startup-remediation-guidance`.
- Startup remediation plan and execution formatting moved out of
  `startup-remediation` into `startup-remediation-format`.
- Startup remediation execution prompt, failure evidence, task-status, and
  outcome helpers moved out of `startup-remediation` into
  `startup-remediation-execution`.
- Startup MVP dependency approval policy parsing, instructions, and formatting
  moved out of `startup-founder-flow` into `startup-dependency-approval`.
- Startup worker governance profile selection and operator notice text moved
  out of `startup-founder-flow` into `startup-worker-governance`.
- Startup founder onboard/build/launch/scale result formatting moved out of
  `startup-founder-flow` into `startup-founder-format`.
- Startup onboarding quickstart and upgrade-guide artifact writing moved out of
  `startup-founder-flow` into `startup-onboarding-files`.
- Startup gate severity rules and blocker remediation text moved out of
  `startup-evidence` into `startup-gate-rules`.
- Startup gate artifact parsing and structured-content helper predicates moved
  out of `startup-evidence` into `startup-gate-artifacts`.
- Startup gate artifact file loading moved out of `startup-evidence` into
  `startup-gate-artifact-store`.
- Startup gate blocker, warning, waiver, finding, and diff evaluation moved out
  of `startup-evidence` into `startup-gate-evaluation`.
- Startup gate UI validation target grouping and failure blocker evaluation moved
  out of `startup-gate-evaluation` into `startup-gate-ui`.
- Startup scale gate handoff, delegation, integration-depth, and GTM blocker
  rules moved out of `startup-gate-evaluation` into `startup-gate-scale`.
- Startup MVP hypothesis, validation, disconfirming-evidence, and structured
  metric gate rules moved out of `startup-gate-evaluation` into
  `startup-gate-validation`.
- Startup launch blocker rules for measurement, repo/security, command,
  remediation quality, UI validation, and accepted debt moved out of
  `startup-gate-evaluation` into `startup-gate-launch`.
- Startup scale founder handoff and support-triage evidence writers moved out
  of `startup-scale-automation` into `startup-scale-founder`.
- Startup scale workflow registry, delegation policy, institutional memory, and
  integration-map evidence writers moved out of `startup-scale-automation` into
  `startup-scale-workflow`.
- Startup scale ops report, report schedule, SOP, and GTM evidence writers moved
  out of `startup-scale-automation` into `startup-scale-ops`.
- CI repair stage/context persistence helpers moved out of
  `ci-repair-orchestrator` into `ci-repair-orchestrator-stage-persistence`.
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
- Wrapped worker structured output schema and validation moved out of
  `wrapped-worker` into `wrapped-worker-structured-output`.
- Wrapped worker governance manifest, launch guardrails, hard-proxy status, and
  prompt construction moved out of `wrapped-worker` into
  `wrapped-worker-governance`.
- Wrapped worker command construction and isolated Codex CLI profile environment
  setup moved out of `wrapped-worker` into `wrapped-worker-command`.
- Wrapped worker subprocess execution, output capture, timeout/truncation
  notices, and progress formatting moved out of `wrapped-worker` into
  `wrapped-worker-process`.
- Startup ready UI smoke expected-text inference moved out of the UI smoke
  executor into `startup-ready-ui-smoke-expect-text`.
- Startup ready UI smoke config types, YAML parsing, legacy shape
  normalization, and serialization moved out of the UI smoke executor into
  `startup-ready-ui-smoke-config`.
- Wrapped-worker stuck progress coverage is stabilized against short timing
  windows in full-suite runs.
- `startup source collect` records structured provider evidence through
  executable adapters.
- Provider adapters classify success, failure, pending, malformed, and
  provider-error payloads while redacting token-like response fields before
  evidence is persisted.
- Source connector readiness tiers are status-aware: failed or unknown
  collected provider evidence stays audit-visible but cannot satisfy
  staging/production tier gates.
- `startup ready --plan` and final readiness evaluation now consume
  staging/production source connector setup requirements.
- Dashboard operator controls can run actions and approve/deny pending
  approvals through the protected local API.
- Dashboard recovery timelines now link resolved blockers to the ready run
  phase, evidence ids, and artifacts that cleared them.
- Dashboard operator console includes action-specific forms for verifier runs
  and manual evidence recording through the protected local API.
- Doctor public result/options contracts and shared pass/fail/node/error helpers
  moved out of `doctor` into `doctor-types`.
- Doctor worker policy action builders, CLI auth hints, Claude probe parsing,
  and model-provider helper predicates moved out of `doctor` into
  `doctor-worker-helpers`.
- Startup complete-check criteria and blocker-accountability rules moved out of
  `startup-complete-check` into `startup-complete-check-criteria`.
- Startup complete-check markdown, JSON, event, score, and status output helpers
  moved out of `startup-complete-check` into `startup-complete-check-output`.
- `email-followup` now has a mature draft-only lifecycle, fixtures, evals,
  gates, report sections, and docs.
- Non-startup golden paths are covered by a combined runbook and CLI/domain
  maturity regression tests for `research-monitor` and `email-followup`.
- `runstead team control-plane bootstrap/check` gives operators a dedicated
  team backend assertion surface.
- CI runs `@runstead/state-postgres` against a real Postgres service via
  `RUNSTEAD_PG_TEST_URL`; local runs skip this integration path unless the env
  var is set.
- Extension collector `outputSchema` is enforced as a runtime evidence
  contract instead of remaining manifest metadata.

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
