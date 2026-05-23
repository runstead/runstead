# Architecture

Runstead Core is domain-agnostic. It owns durable goals, tasks, events, and the
state-machine contracts that let work be resumed, verified, and audited.

The current implementation keeps the package graph intentionally small:

- `@runstead/core`: shared schemas, IDs, and control-plane contracts
- `@runstead/governance`: policy evaluation, action risk scoring, and reusable
  governance primitives
- `@runstead/runtime`: task execution semantics and worker lifecycle result
  mapping shared by concrete runners
- `@runstead/state-sqlite`: SQLite schema and state-store adapter
- `@runstead/domain-packs`: built-in `repo-maintenance` pack and validation
- `@runstead/skills`: skill package contracts, candidate scaffolding, and tests
- `@runstead/cli`: local command surface
- `@runstead/testkit`: fixture and temporary workspace helpers

Tool execution, verifiers, evidence capture, and workers still have concrete
M1/M2 implementations inside `@runstead/cli` while their interfaces harden.
Policy and risk primitives have moved into `@runstead/governance`; task
execution semantics and worker lifecycle result mapping have moved into
`@runstead/runtime`. Split the remaining runtime surfaces out when reuse across
runtimes requires it:

- `@runstead/tools`
- `@runstead/verifiers`
- `@runstead/evidence`
- `@runstead/workers`
