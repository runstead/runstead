# Architecture

Runstead Core is domain-agnostic. It owns durable goals, tasks, events, and the
state-machine contracts that let work be resumed, verified, and audited.

The current implementation keeps the package graph intentionally small:

- `@runstead/core`: shared schemas, IDs, and control-plane contracts
- `@runstead/state-sqlite`: SQLite schema and state-store adapter
- `@runstead/domain-packs`: built-in `repo-maintenance` pack and validation
- `@runstead/skills`: skill package contracts, candidate scaffolding, and tests
- `@runstead/cli`: local command surface
- `@runstead/testkit`: fixture and temporary workspace helpers

Policy, tools, verifiers, evidence, and workers have concrete M1/M2
implementations inside `@runstead/cli` while their interfaces harden. Split them
out only when reuse across runtimes requires it:

- `@runstead/policy`
- `@runstead/tools`
- `@runstead/verifiers`
- `@runstead/evidence`
- `@runstead/workers`
