# Security Model

Runstead is a local and CI control plane for agent-built product work. Its
security model is based on explicit worker boundaries, policy decisions,
approval records, evidence, and replayable audit state.

Runstead does not make an arbitrary coding agent safe by itself. The guarantee
depends on the selected worker mode and on where the action executes.

## Assurance Levels

### Level 1: Readiness Wrapper

Used by `codex_cli` and `claude_code`.

Runstead controls the work around the external worker:

- records the task, worker run, policy boundary, and selected verifier plan
- creates checkpoints before execution
- applies dependency and protected-path policy at the run boundary
- runs verifiers, UI smoke, launch checks, and complete checks after execution
- records evidence and target-aware readiness verdicts

Runstead does not hard-proxy tool calls that happen inside the external worker.
For example, a wrapped `codex_cli` run is still relying on Codex CLI sandbox and
approval behavior for worker-internal file, shell, or MCP calls.

Use this level for trusted local MVP work where post-run evidence and launch
gates are the main requirement.

### Level 2: Governed Execution

Used by `codex_direct`.

Runstead exposes a native tool surface to the model and evaluates each exposed
tool action before it runs:

- filesystem read, write, patch, stat, search, and tree operations
- shell commands
- git reads and controlled git writes
- verifier runs
- evidence reads and writes
- workspace facts reads

Policy decisions, approval requests, approval grant reuse, tool calls, and
outputs are written to the Runstead state store. Protected paths and external
side effects can be denied or approval-gated before execution.

Use this level for protected workspaces, production-adjacent changes, security
review, compliance-sensitive work, and any flow that needs per-tool-call audit.

## Trust Boundaries

Runstead treats these as separate boundaries:

- **Workspace boundary:** the repository under `--cwd`. Native filesystem tools
  normalize paths and reject symlink traversal outside the workspace.
- **Runstead state boundary:** `.runstead/` and the configured state DB contain
  control-plane data and should be protected from worker writes.
- **Worker boundary:** wrapped workers are external runtimes; native proxy
  workers operate through Runstead-owned tools.
- **Network and platform boundary:** GitHub, deployment providers, analytics,
  support systems, and CI logs are external evidence sources. Runstead records
  source URIs, summaries, hashes, and freshness metadata when available.
- **Human approval boundary:** approvals convert a policy block into a durable
  human decision. Approval grants are single-use and are expired when consumed.

## Approval And Resume

Approval requests are tied to the policy decision and action payload that
created them. For `codex_direct` filesystem patches, Runstead records touched
files, dependency impact, diff hash, risk class, risk summary, pending patch
payload, and canonical signature.

When the model regenerates an equivalent governed action after approval,
Runstead may consume an approved grant by either exact action id or canonical
signature. Tool-call output records which match type was used so audit export
can explain why the resumed action did not ask for a second approval.

## Secrets

Runstead can enforce policy around secret paths and environment files, but it
does not guarantee that a wrapped worker cannot see secrets that its own
runtime exposes. Treat `.env`, production credentials, cloud tokens, private
keys, and customer exports as protected by default.

Recommended defaults:

- deny `.git/**` and `.runstead/**`
- approval-gate `.env*`, secret stores, deployment manifests, production infra,
  dependency lockfiles, pushes, pull requests, and release actions
- avoid passing production secrets into local worker sessions
- use CI secrets only for CI jobs that need them, not for local readiness runs

## Audit State

Runstead persists events and projections in SQLite. The state store is intended
to be durable local audit state, not a multi-tenant security boundary.
Runstead sets the SQLite database file and WAL/SHM sidecars to owner-only
permissions when it opens the state store.

The state DB records:

- tasks, worker runs, tool calls, approvals, and policy decisions
- evidence references, freshness, and source metadata
- readiness reports, CI summaries, and gate decisions
- migrations and schema version state

Local filesystem permissions, backups, and access control for the host machine
remain the operator's responsibility.

## What Runstead Does Not Defend Against

Runstead does not defend against:

- a malicious or compromised host OS
- an external wrapped worker bypassing its own sandbox
- credentials already available to the worker process
- malicious dependencies executed by a verifier command
- network exfiltration from tools that Runstead did not proxy
- tampering with local state files by a user or process with write access
- repository code that intentionally lies in tests, build scripts, or logs

For high-assurance work, use `codex_direct`, deny sensitive paths, keep external
writes approval-gated, run verifiers in clean CI, and treat third-party source
evidence as higher confidence than model-written summaries.

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

The first command gives stronger tool-level governance. The second command
gives a faster product-readiness loop with checkpoints, evidence, reports, and
gates around the external worker.
