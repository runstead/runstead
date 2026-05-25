# Security Model

Runstead is a local and CI control plane for agent-built product work. Its
security model is based on explicit worker boundaries, policy decisions,
approval records, evidence, and replayable audit state.

Runstead does not make an arbitrary coding agent safe by itself. The
guarantee depends on the selected worker mode and on where the action
executes.

## Assurance Levels

### Level 1: Readiness Wrapper

Used by `codex_cli` and `claude_code`.

Runstead controls the work around the external worker:

- records the task, worker run, policy boundary, and selected verifier plan
- creates checkpoints before execution
- applies dependency and protected-path policy at the run boundary
- runs verifiers, UI smoke, launch checks, and complete checks after
  execution
- records evidence and target-aware readiness verdicts

Runstead does not hard-proxy tool calls that happen inside the external
worker. A wrapped `codex_cli` run is still relying on Codex CLI sandbox and
approval behavior for worker-internal file, shell, or MCP calls.

Use this level for trusted local MVP work where post-run evidence and
launch gates are the main requirement.

### Level 2: Governed Execution

Used by `codex_direct`.

Runstead exposes a native tool surface to the model and evaluates each
exposed tool action before it runs:

- filesystem read, write, patch, stat, search, and tree operations
- shell commands
- git status, diff, log, show, and diff-summary reads
- verifier runs
- evidence reads; verifier and command execution record evidence through
  Runstead-owned runtime paths
- workspace facts reads
- model inference requests (`model.inference.request` with
  `network_write_external` and `llm_data_egress` side effects)

Policy decisions, approval requests, approval grant reuse, tool calls, and
outputs are written to the Runstead state store. Protected paths and
external side effects can be denied or approval-gated before execution.

Use this level for protected workspaces, production-adjacent changes,
security review, compliance-sensitive work, and any flow that needs
per-tool-call audit.

## Trust Boundaries

Runstead treats these as separate boundaries:

- **Workspace boundary:** the repository under `--cwd`. Native filesystem
  tools normalize paths (using POSIX normalization that resolves `..`
  segments) and reject symlink traversal outside the workspace. Protected
  paths are matched after normalization, so `src/../.env` and `.env` are
  treated identically.
- **Runstead state boundary:** `.runstead/` and the configured state DB
  contain control-plane data and should be protected from worker writes.
  SQLite database and WAL/SHM sidecars are set to owner-only (`0o600`)
  permissions when opened.
- **Worker boundary:** wrapped workers are external runtimes; native proxy
  workers operate through Runstead-owned tools.
- **Network and platform boundary:** GitHub, deployment providers,
  analytics, support systems, and CI logs are external evidence sources.
  Runstead records source URIs, summaries, hashes, and freshness metadata
  when available, and `runstead startup source verify` can HTTP-fetch the
  URI to confirm status code and expected text before recording the
  evidence artifact.
- **Human approval boundary:** approvals convert a policy block into a
  durable human decision. Approval grants may be single-use, or scoped
  until expiry when the action declares a narrow reusable scope (for
  example a task-owned scaffold patch).
- **Operator console boundary:** the dashboard HTTP server is read-only by
  default. The mutating Operator API is opt-in via `--enable-operator-api`,
  binds to local addresses only, enforces same-origin requests, requires a
  session bearer and a CSRF token, and routes every mutation through RBAC.

## Approval And Resume

Approval requests are tied to the policy decision and action payload that
created them. For `codex_direct` filesystem patches, Runstead records
touched files, dependency impact, diff hash, risk class, risk summary,
pending patch payload, and canonical signature.

When the model regenerates an equivalent governed action after approval,
Runstead may consume an approved grant by exact action id, canonical
signature, or a scoped approval grant. Scoped grants are only issued by
action contracts that declare a narrow scope, for example a `codex_direct`
scaffold app patch bound to one task id and scaffold profile. Tool-call
output records which match type was used so audit export can explain why
the resumed action did not ask for a second approval.

Approved pending patches are applied directly on resume rather than asking
the model to regenerate the patch.

## Resilience And Recovery

- model requests run inside `runModelRequestWithHeartbeat` with bounded
  retries on transient errors, jittered backoff, and timeout abort
- task and worker-run rows carry an `lease_expires_at` column;
  `runstead resume` re-queues tasks past their lease so a crashed runner
  cannot pin a task in `running` forever
- the green path skips the agent when current verifier evidence matches the
  current code fingerprint, avoiding model cost and risk for unchanged code
- verifier-only recovery promotes an agent-reported failure to
  `completed_with_warnings` when the fingerprint matches and verifiers pass

## Secrets

Runstead can enforce policy around secret paths and environment files, but
it does not guarantee that a wrapped worker cannot see secrets that its own
runtime exposes. Treat `.env`, production credentials, cloud tokens,
private keys, and customer exports as protected by default.

Recommended defaults:

- deny `.git/**` and `.runstead/**`
- approval-gate `.env*`, secret stores, deployment manifests, production
  infra, dependency lockfiles, pushes, pull requests, and release actions
- avoid passing production secrets into local worker sessions
- use CI secrets only for CI jobs that need them, not for local readiness
  runs
- extension collectors that need real secrets must declare them in
  `requiredSecrets`; collectors with secrets are not assumed to be
  `safeForWrappedWorkers`

## Audit State

Runstead's default local state store persists events and projections in
SQLite. The state store is intended to be durable local audit state, not a
multi-tenant security boundary.

`@runstead/state-postgres` provides a shared transactional backend adapter
and conformance-tested runtime contract for team control-plane experiments.
That package is not, by itself, an organization security boundary: team
deployments still need configured backend profiles, runner identity, RBAC,
secret boundaries, shared artifact storage, and operational ownership.

Both backends are exercised by
`runRuntimeControlPlaneBackendConformance` from `@runstead/testkit`. The
suite asserts:

- atomic event + projection writes
- idempotency-keyed retry
- `expectedRevision` optimistic concurrency conflict
- lock acquire/renew/release with fencing tokens
- artifact write/read with content hash

The state DB records:

- tasks, worker runs, tool calls, approvals, and policy decisions
- evidence references, freshness, and source metadata
- readiness reports, CI summaries, gate decisions, and release decisions
- migrations and schema version state

Local filesystem permissions, backups, and access control for the host
machine remain the operator's responsibility.

## Team Control Plane Boundary

Runstead's current production-ready product shape is local workstations and
CI jobs. A team-level deployment needs the shared-backend contract plus
operational controls:

- shared transactional storage instead of local SQLite
- registered runners with heartbeat and lease ownership
- distributed leases with fencing tokens
- append-only or hash-chain audit export
- organization identity, RBAC, tenant isolation, and central secret
  boundaries

`@runstead/runtime` exposes `assessTeamControlPlaneReadiness` so
integrations can check those capabilities explicitly, and
`@runstead/state-postgres` provides
`createPostgresTeamControlPlaneProfile`, which produces a profile that
satisfies the assessment. A local `.runstead/state.db` can be good audit
evidence for one workspace, but it must not be presented as an
organization-wide, multi-tenant security boundary.

## Dashboard Operator API

The dashboard HTTP server is read-only by default. With
`--enable-operator-api`, Runstead exposes mutating endpoints:

- `POST /operator-actions/<id>/run`
- `POST /approvals/<id>/(approve|deny)`
- `POST /runs/<id>/resume`
- `POST /verifiers/run`
- `POST /evidence/manual`

Every request must:

1. originate from a local interface (`127.0.0.1` or `::1`)
2. match the same origin (CSRF defense)
3. carry `x-runstead-session-token` (or `Authorization: Bearer …`)
4. carry `x-runstead-csrf-token`

Both tokens are randomly generated 24-byte hex strings, printed once at
server start, and live only inside the running process. Every mutation
still goes through Runstead policy, RBAC, and audit; the API is a
transport, not a bypass.

## What Runstead Does Not Defend Against

Runstead does not defend against:

- a malicious or compromised host OS
- an external wrapped worker bypassing its own sandbox
- credentials already available to the worker process
- malicious dependencies executed by a verifier command
- network exfiltration from tools that Runstead did not proxy
- tampering with local state files by a user or process with write access
- repository code that intentionally lies in tests, build scripts, or logs
- a misconfigured Postgres backend that exposes the control-plane database
  to a wider audience than intended

For high-assurance work, use `codex_direct`, deny sensitive paths, keep
external writes approval-gated, run verifiers in clean CI, and treat
third-party source evidence verified via `startup source verify` as higher
confidence than model-written summaries.

## Operational Baseline

For a strict governed run:

```bash
runstead agent run \
  --cwd /path/to/repo \
  --worker codex_direct \
  --mode repair \
  --denied ".git/**" \
  --denied ".runstead/**" \
  --verifier "test=npm test" \
  --verifier "lint=npm run lint" \
  "Make the smallest safe repair."
```

For founder-speed readiness work:

```bash
runstead startup ready \
  --cwd /path/to/mvp \
  --stage launch \
  --target local \
  --worker codex_cli \
  --governance readiness
```

For governance-sensitive readiness:

```bash
runstead startup ready \
  --cwd /path/to/mvp \
  --stage launch \
  --target production \
  --worker codex_direct \
  --governance governed
```

The first command gives stronger tool-level governance. The second command
gives a faster product-readiness loop with checkpoints, evidence, reports,
and gates around the external worker. The third combines the Level 2 native
proxy with the strictest readiness target.
