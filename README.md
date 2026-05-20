# Runstead

Runstead is the control plane for governed AI-native execution, starting with
repo maintenance and launch-ready software delivery.

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
unknown actions, and export an audit trail. That wedge keeps Runstead focused on
real governed execution while the product surface expands toward AI-coded MVP and
launch-readiness workflows.

```bash
runstead init --create-default-goal
runstead run --once
runstead status
runstead audit export
runstead report weekly --print
```

## Recommended local practice

For real local coding work today, start with **Runstead + `codex_cli`**. Codex
CLI owns the coding-agent runtime, login session, MCP servers, plugins, and
interactive ecosystem. Runstead owns the repo-maintenance control plane around
that worker: task records, policy, approval, checkpoints, verifier evidence,
diff-scope checks, audit, resume, and reports.

```bash
codex login
runstead init --cwd /path/to/repo --profile trusted-local --create-default-goal
runstead doctor --cwd /path/to/repo --codex --worker codex_cli --model gpt-5.5
```

Run an inspected local task through Codex CLI:

```bash
runstead agent run \
  --cwd /path/to/repo \
  --worker codex_cli \
  --model gpt-5.5 \
  --mode read-only \
  "Inspect this repo and summarize the main test commands."
```

Run an edit task with Runstead verifier evidence:

```bash
runstead agent run \
  --cwd /path/to/repo \
  --worker codex_cli \
  --model gpt-5.5 \
  --mode edit \
  --allowed "src/**" \
  --verifier "test=pnpm test" \
  "Fix the failing test with the smallest reasonable change."
```

Use the same worker for governed CI repair orchestration:

```bash
runstead repair-ci <github-actions-run-id> \
  --cwd /path/to/repo \
  --worker codex_cli \
  --model gpt-5.5 \
  --allowed "src/**" \
  --verifier "test=pnpm test"
```

After a run, inspect the Runstead-side record:

```bash
runstead agent report <task-id> --cwd /path/to/repo
runstead audit replay <task-id> --cwd /path/to/repo
```

Choose **Runstead + `codex_direct`** when the task requires hard-proxied
Runstead tool calls. `codex_direct` runs the model loop inside Runstead, so
filesystem, shell, git, verifier, and evidence actions pass through Runstead
policy and audit before they execute. That gives stronger governance, but it
does not yet inherit the full Codex CLI MCP/plugin ecosystem.

Choose **Runstead + `claude_code`** when the repo or developer workflow already
standardizes on Claude Code CLI. It follows the same Level 1 wrapped-worker
model as `codex_cli`.

Use `runstead init --profile trusted-local --create-default-goal` on a trusted
local workstation when you want CI repair to start the built-in wrapped coding
workers without the first approval prompt while still requiring approval for
dependency changes and publishing.

Use `runstead agent providers` to list model providers available to
`codex_direct`. The Codex Direct provider uses `runstead codex login`;
OpenAI-compatible, Anthropic, Gemini, and local providers use `model.provider`,
`model.name`, `model.baseUrl`, and API key environment variables.

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

## Startup Execution Direction

Runstead does not replace Codex, Claude Code, or other coding agents. Those
workers execute. Runstead owns the goal, policy, verifier, evidence, checkpoint,
audit, and resume layer around that execution.

The founder-facing product path is **AI-coded MVP readiness**: keep agent-built
products verifiable, auditable, and launch-ready before they accumulate opaque
technical debt or ship without a measurement framework.

See [docs/product-positioning.md](docs/product-positioning.md) and
[docs/startup-lifecycle.md](docs/startup-lifecycle.md) for the startup control
plane roadmap.
