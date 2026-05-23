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
OpenAI-compatible chat completion shapes. The remaining extraction boundary is
the local runner implementation currently hosted by the CLI.
