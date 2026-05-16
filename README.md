# Runstead

Runstead is the control plane for AI agents that maintain software repos.

Give Runstead durable goals, budgets, policies, and acceptance criteria.
Runstead turns them into tasks, dispatches worker agents, guards actions with
policy, verifies outputs with evidence, records audit logs, and resumes after
failures.

Runstead provides **Level 1 wrapped execution** for external coding agents: it
gates worker launch, checkpoints the workspace, verifies results, and audits
side effects. It also provides a native `codex_direct` local agent path where
Runstead proxies model tool calls through governed filesystem, shell, git, and
evidence actions.

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

Use `runstead init --profile trusted-local --create-default-goal` on a trusted
local workstation when you want CI repair to start the built-in wrapped coding
workers without the first approval prompt while still requiring approval for
dependency changes and publishing.

Use `runstead agent providers` to list model providers available to
`codex_direct`. Codex uses `runstead codex login`; OpenAI-compatible,
Anthropic, Gemini, and local providers use `model.provider`, `model.name`,
`model.baseUrl`, and API key environment variables.

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
