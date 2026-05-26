# Architecture

Runstead is a layered control plane. The bottom layers are contract packages
that an external runtime, IDE plugin, or third-party extension can depend on
without pulling in any CLI internals. The CLI is one concrete host on top of
those contracts; team-mode hosts replace its storage and execution wiring
through the same interfaces.

## Package Graph

Contract packages (stable, side-effect free, no Node-specific hosting):

- `@runstead/core`: shared schemas, IDs, durable goal/task/event types
- `@runstead/runtime`: task execution semantics, worker lifecycle result
  mapping, readiness plan/verdict/release-decision engine,
  storage/lock/artifact backend contracts, team-control-plane contracts,
  readiness run snapshot helpers, source-provider response normalization and
  secret redaction, provider-neutral tool-call adapter primitives (Codex
  Responses, OpenAI-compatible chat completions), and startup UI smoke failure
  classification
- `@runstead/governance`: policy DSL parser, deterministic evaluator with
  deny > approval > allow precedence, action risk scorer, reusable policy
  factories (protected paths, dangerous shell, dependency change, verifier
  command, external write, worker start, model inference)
- `@runstead/tools`: governed tool action contract registry covering
  filesystem read/list/search/stat/write/patch, model-exposed git reads
  (status, diff, log, show) plus orchestration-owned git branch/commit/push
  actions, shell.exec, verifier.run, evidence.read, workspace.facts.read,
  package.install and package.update, github.run.read, github.run.log.read,
  github.pr.create, repo.publish_repair, worker.external.start,
  worker.native.start, model.inference.request, checkpoint.create, and
  checkpoint.restore
- `@runstead/verifiers`: command verifier input/result shapes and
  pass/fail classification
- `@runstead/evidence`: evidence quality tier ladder
  (none → self_reported → local_artifact → machine_verified →
  external_observed), source trust ladder, evidence source schema
- `@runstead/workers`: worker capability and governance-level contracts
- `@runstead/sdk`: public extension manifest, `defineRunsteadExtension`,
  `validateRunsteadExtension`, `compileRunsteadExtensionRuntime`,
  `extensionReadinessEvidenceRequirements`
- `@runstead/skills`: experimental skill package validation and lifecycle

Storage backends:

- `@runstead/state-sqlite`: default local SQLite state store, schema
  migrations, owner-only file permissions, manager lock, execution leases
- `@runstead/state-postgres`: Postgres `RuntimeControlPlaneBackend` adapter
  with `expectedRevision` optimistic concurrency, idempotency keys, advisory
  lock fencing tokens, JSONB projections, hash-addressed artifacts, and
  schema migrations with checksum verification plus printable migration SQL.
  Hosts can attach either a `pg`-compatible Node client through
  `NodePostgresControlPlaneClient` or the deployment/test `psql` bridge through
  `PsqlPostgresControlPlaneClient`.

Domain content and runtime host:

- `@runstead/domain-packs`: built-in `repo-maintenance`, `ai-native-startup`,
  and `research-monitor` packs
- `@runstead/cli`: local command surface; hosts the startup-ready
  orchestrator, the codex-direct worker, wrapped-worker integration, CI repair
  orchestrator, dashboard server, daemon, and webhook intake
- `@runstead/testkit`: control-plane conformance suite
  (`runRuntimeControlPlaneBackendConformance`), fixture and temp-workspace
  helpers

## Where Runtime Boundaries Live

Policy and risk primitives live in `@runstead/governance`. Task execution
semantics, worker lifecycle result mapping (`implementation × verification ×
agentCompletion`), and readiness verdict compilation live in `@runstead/runtime`,
along with:

- backend contracts: `RuntimeEventStore`, `RuntimeLockManager`,
  `RuntimeArtifactStore`, `RuntimeControlPlaneBackend`
- team contracts: `RuntimeTeamControlPlaneProfile`,
  `assessTeamControlPlaneReadiness`
- readiness contracts: `compileReadinessPlan`,
  `evaluateCompiledReadinessPlan`, `compileReadinessReleaseDecision`,
  `ReadinessEvidenceRequirement`
- source provider contracts: `parseRuntimeSourceConnectorResponseJson`,
  `collectRuntimeSourceProviderPayload`, and
  `runtimeSourceProviderAuthHeaders`
- tool-call adapters: `codexResponsesToolCallAdapter`,
  `openAiChatCompletionsToolCallAdapter`
- UI smoke semantics: `classifyRuntimeStartupUiValidationFailure`
  (product_gap, selector_unstable, browser_runtime, network, unknown)
- readiness run snapshot: `RuntimeReadinessRunSnapshot`,
  `createReadinessRunSnapshotEvent`

Verifier command inputs, result records, and pass/fail classification live in
`@runstead/verifiers` so domain integrations and repair loops do not import
CLI internals to reason about verifier evidence. Tool action contracts live
in `@runstead/tools` so any runtime that needs to evaluate policy or audit a
side effect uses the same registry. Evidence quality and trust live in
`@runstead/evidence` for the same reason.

The intentionally CLI-local boundary is the concrete host implementation: local
subprocess execution, SQLite-backed local projections, artifact file writing,
the startup-ready phase orchestrator, UI smoke execution, the dashboard HTTP
server, and concrete Codex Direct tool routing. External domain integrations
should import `@runstead/runtime`, `@runstead/verifiers`,
`@runstead/governance`, or `@runstead/sdk` instead of `@runstead/cli`.

## CLI Internal Decomposition

The two large CLI internals are decomposed into directories. Both old entry
files (`startup-ready.ts`, `codex-direct-worker.ts`) are stable re-exports.

`packages/cli/src/startup-ready/` (orchestrator and 18 supporting modules):

- `index.ts`: main run/plan entrypoints, phase wiring, persistence
- `plan.ts`: `planStartupReady`, extension discovery, phase plan
- `build-mvp-phase.ts`: green-path preflight and worker invocation
- `verifier-phase.ts`: verifier orchestration with fingerprint reuse
- `ui-smoke-phase.ts`: UI smoke execution and bounded auto-repair
- `report-phase.ts`: launch audit, security baseline, launch/complete reports
- `decision.ts`: target-aware readiness decision rendering
- `format.ts`: operator-facing run summary rendering
- `operator-actions.ts`: persisted operator command catalogue
- `local-evidence.ts`: conservative local baseline ingest
- `evidence.ts`, `finalize.ts`, `progress.ts`, `run-state.ts`,
  `shared.ts`, `types.ts`, `options.ts`, `context-phase.ts`,
  `constants.ts`

`packages/cli/src/codex-direct/` (native worker and tool router):

- `worker.ts`: top-level worker loop, model turn budgeting, resume
- `tool-router.ts`, `tool-definitions.ts`, `tool-arguments.ts`,
  `tool-types.ts`: governed dispatch surface and JSON schemas
- `governed-tools.ts`: shared `runGovernedToolAction` invocation paths
- `model-request.ts`: heartbeat, timeout abort, bounded retry with jitter
  for transient model errors
- `patch-actions.ts`: scaffold-aware `apply_patch` classification
- `git-actions.ts`, `evidence-actions.ts`, `policy-actions.ts`,
  `result.ts`, `constants.ts`, `prompts.ts`

## Storage And Team Mode

The default shipped product is local workstations and CI: SQLite state, local
artifacts, a manager lock under `.runstead`, and execution leases for
stale-run recovery.

`@runstead/state-postgres` implements `RuntimeControlPlaneBackend` for shared
state. `runRuntimeControlPlaneBackendConformance` exercises the same five
checks on both backends:

- atomic event append + projection write
- idempotency-keyed retry
- `expectedRevision` optimistic concurrency conflict
- lock acquire/renew/release lifecycle
- artifact write/read with content hash

The Postgres adapter also owns the first team-runner persistence path:
`runtime_runners` stores runner identity, labels, status, and `last_seen_at`
heartbeats so team readiness can consume backend-written liveness records
instead of only environment-supplied profile assertions.

`createPostgresTeamControlPlaneProfile` returns a
`RuntimeTeamControlPlaneProfile` that satisfies
`assessTeamControlPlaneReadiness`. A real organization deployment must still
wire: runner identity and heartbeat, IdP/RBAC, central secret store, and
shared artifact storage (S3 or equivalent). Local SQLite must not be
presented as a multi-tenant security boundary.

Operators can print the deployable Postgres schema with:

```bash
runstead team control-plane migration-sql --schema runstead
```

The SQL includes schema creation, versioned migration tracking, runtime event,
projection, idempotency, lock, artifact tables, query indexes, and a checksum
record for the applied migration.

Operators can also make `runstead team control-plane check` perform a live
backend probe:

```bash
runstead team control-plane check --cwd /path/to/repo --live --migrate
```

In live mode the CLI connects to Postgres, optionally applies migrations, reads
`runtime_runners`, and feeds backend-recorded runner ids and heartbeat
timestamps into the team-readiness assessment.

Node-based runners should prefer `NodePostgresControlPlaneClient` with a
`pg.Client` or `pg.Pool`-compatible object so parameterized SQL stays in the
driver path. `PsqlPostgresControlPlaneClient` remains available for smoke tests,
deployment diagnostics, and environments where only the `psql` binary is
installed.

## Extension Loading Pipeline

```
.runstead/extensions/*.{yaml,yml,json}      ← author surface
    │
    ▼
parseExtensionManifest (yaml/json)          ← in @runstead/cli
    │
    ▼
compileRunsteadExtensionRuntime             ← in @runstead/sdk
    │  resolves gate→facet references
    │  flattens evidenceRequirements
    │  computes safeForWrappedWorkers
    │  raises RunsteadExtensionCompileError on bad references
    ▼
extensionReadinessEvidenceRequirements      ← in @runstead/sdk
    │
    ▼
compileReadinessPlan + evaluate…            ← in @runstead/runtime
    │  contributes blockers when required tiers/types are missing
    ▼
startupReadinessExtensionPolicyBlockers     ← in @runstead/cli
    │  rejects unsafe collectors on Level 1 wrapped workers
    │  rejects quality below target minimum
    │  rejects missing freshness for staging/production
    ▼
executeStartupReadinessExtensions           ← in @runstead/cli
       runs each collector command through runGovernedToolAction,
       parses JSON evidence, records it as startup evidence
```

## ADRs

- [adr/0001-node-typescript-monorepo.md](adr/0001-node-typescript-monorepo.md):
  pnpm workspace, Node 24, Turbo, Vitest baseline
