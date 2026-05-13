# ADR 0001: Node.js + TypeScript Monorepo Baseline

Status: accepted

## Context

Runstead is a control plane, not a single worker. The product plan already
separates core orchestration, state, domain packs, policy, tools, verifiers,
evidence, and worker adapters. Those seams need clear package boundaries before
the project grows.

## Decision

Use a pnpm workspace monorepo with a small first package set:

- `@runstead/cli`
- `@runstead/core`
- `@runstead/state-sqlite`
- `@runstead/domain-packs`
- `@runstead/testkit`

Pin the project baseline to Node.js 24.15+ and pnpm 11. Use Turbo for task
orchestration, TypeScript 6.0 as the stable bridge toward TypeScript 7, and
Vitest for tests.

Package builds use native `tsc` emit for now. Runstead is a Node-first CLI and
library set, and native emit preserves `node:` specifiers like `node:sqlite`
without bundler compatibility risk.

## Consequences

Package boundaries are explicit from day one, but the first cut avoids
over-splitting. Policy, tools, verifiers, evidence, and workers should become
separate packages only when their interfaces harden during M1/M2.
