# Architecture

Runstead Core is domain-agnostic. It owns durable goals, tasks, events, and the
state-machine contracts that let work be resumed, verified, and audited.

The current implementation keeps the package graph intentionally small:

- `@runstead/core`: shared schemas, IDs, and control-plane contracts
- `@runstead/governance`: policy evaluation, action risk scoring, and reusable
  governance primitives
- `@runstead/runtime`: task execution semantics, worker lifecycle result mapping,
  storage/lock/artifact backend contracts, and provider-neutral tool-call
  adapter primitives shared by concrete runners
- `@runstead/tools`: governed tool action contracts used by policy and audit
- `@runstead/verifiers`: verifier command contracts shared by agents, repair
  loops, and startup readiness
- `@runstead/evidence`: evidence quality/source contracts for readiness gates
  and external connectors
- `@runstead/workers`: worker capability and governance-level contracts
- `@runstead/state-sqlite`: SQLite schema and state-store adapter
- `@runstead/state-postgres`: Postgres control-plane backend adapter for shared
  runtime experiments
- `@runstead/domain-packs`: built-in `repo-maintenance` pack and validation
- `@runstead/skills`: skill package contracts, candidate scaffolding, and tests
- `@runstead/sdk`: public extension contracts for readiness facets, evidence
  collectors, verifiers, and gates
- `@runstead/cli`: local command surface
- `@runstead/testkit`: fixture and temporary workspace helpers

Tool execution, verifiers, evidence capture, and workers still have concrete
M1/M2 implementations inside `@runstead/cli`, but their stable contracts now
live outside the CLI. Policy and risk primitives have moved into
`@runstead/governance`; task execution semantics and worker lifecycle result
mapping have moved into `@runstead/runtime`, along with backend contracts for
event append concurrency, lock managers, artifact stores, local `RUNSTEAD_HOME`
layout, and standard tool-call adapter primitives for Codex Responses and
OpenAI-compatible chat completion shapes. Verifier command inputs, result
records, and pass/fail classification live in `@runstead/verifiers` so domain
integrations and repair loops do not import CLI internals to reason about
verifier evidence. Runtime also defines the team control-plane contracts that a
future shared backend must satisfy: organization scope, registered runners,
distributed leases with fencing tokens, append-only audit sinks, and non-local
identity/RBAC/secret boundaries.

The intentionally CLI-local boundary is now the concrete host implementation:
local subprocess execution, SQLite-backed local projections, artifact file
writing, startup-ready phase orchestration, UI smoke execution, dashboard
rendering, and concrete Codex Direct tool routing. These can keep moving behind
package contracts, but external domain integrations should import
`@runstead/runtime`, `@runstead/verifiers`, `@runstead/governance`, or
`@runstead/sdk` instead of `@runstead/cli`.

The default shipped product path remains local/CI-oriented: SQLite state, local
artifacts, and a manager lock under `.runstead`. `@runstead/state-postgres` now
implements the runtime backend contract for shared transactional state, but a
team or organization deployment still needs profile wiring, registered runners,
identity/RBAC, central secret handling, and shared artifact storage. Use the
runtime team-control-plane assessment as the integration contract; do not treat
the local SQLite backend as a multi-user service.
