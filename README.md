# Runstead

Runstead is the control plane for AI agents that maintain software repos.

Give Runstead durable goals, budgets, policies, and acceptance criteria.
Runstead turns them into tasks, dispatches worker agents, guards actions with
policy, verifies outputs with evidence, records audit logs, and resumes after
failures.

## Setup

This repository is a pnpm workspace monorepo targeting Node.js 24 LTS.

```bash
nvm use
corepack enable pnpm
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Packages

- `@runstead/cli`: command-line interface
- `@runstead/core`: domain-agnostic control-plane contracts
- `@runstead/state-sqlite`: SQLite state store
- `@runstead/domain-packs`: built-in domain packs
- `@runstead/testkit`: test helpers and fixture utilities

## First domain pack

`repo-maintenance`

- Keep CI green
- Run deterministic verifiers
- Store evidence
- Audit state transitions
- Resume after crashes
