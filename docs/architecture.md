# Architecture

Runstead Core is domain-agnostic. It owns durable goals, tasks, events, and the
state-machine contracts that let work be resumed, verified, and audited.

The initial implementation keeps the package graph intentionally small:

- `@runstead/core`: shared schemas, IDs, and control-plane contracts
- `@runstead/state-sqlite`: SQLite schema and state-store adapter
- `@runstead/domain-packs`: built-in `repo-maintenance` pack and validation
- `@runstead/cli`: local command surface
- `@runstead/testkit`: fixture and temporary workspace helpers

The next package split should happen when M1 starts:

- `@runstead/policy`
- `@runstead/tools`
- `@runstead/verifiers`
- `@runstead/evidence`
- `@runstead/workers`
