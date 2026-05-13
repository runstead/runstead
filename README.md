# Runstead

Runstead is the control plane for AI agents that maintain software repos.

Give Runstead durable goals, budgets, policies, and acceptance criteria.
Runstead turns them into tasks, dispatches worker agents, guards actions with
policy, verifies outputs with evidence, records audit logs, and resumes after
failures.

The first supported product path is **repo-maintenance**: create a long-running
goal, run governed local verifiers, capture evidence, request approvals for
unknown actions, and export an audit trail.

```bash
runstead init --create-default-goal
runstead run --once
runstead status
runstead audit export
runstead report weekly --print
```

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

Other domain packs, memory, skill packaging, dashboard, GitHub App mode, RBAC,
webhooks, and team-policy overlays are available as experimental surfaces while
the repo-maintenance control loop remains the primary MVP.
