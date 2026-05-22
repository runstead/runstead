# Worker Selection

Runstead can run external coding agents as wrapped workers or run a native
Codex loop through `codex_direct`. The right default depends on the user's risk
profile.

## Default Recommendation

Use **Runstead + `codex_cli`** by default.

This is the best current fit for founder-facing AI-coded MVP work because it
keeps the normal Codex CLI runtime and ecosystem while Runstead supplies the
control plane around it:

- task records
- checkpoints
- dependency policy
- verifier evidence
- launch and scale gates
- readiness reports
- audit and replay surfaces

For most MVP work, this is the practical balance: agent velocity stays high and
Runstead still prevents "agent finished" from becoming the readiness standard.

## When To Use `codex_cli`

Choose `codex_cli` when:

- the user wants the normal Codex CLI experience
- the task benefits from existing Codex CLI login, MCP servers, plugins, or
  local runtime behavior
- the repo is a trusted local workspace
- post-run verifier evidence is enough for the risk level
- the main concern is launch readiness rather than per-tool-call compliance

Typical command:

```bash
runstead startup build-mvp \
  --cwd /path/to/mvp \
  --worker codex_cli \
  --dependency-policy deny-new
```

## When To Use `codex_direct`

Choose `codex_direct` when:

- every exposed model tool call must be governed by Runstead policy
- filesystem, shell, git, verifier, and evidence actions need hard-proxy audit
- the repo has strict protected paths or approval boundaries
- the team needs evidence that the model could not bypass Runstead's tool layer
- the task is compliance-sensitive, security-sensitive, or production-adjacent

Typical command:

```bash
runstead agent run \
  --cwd /path/to/repo \
  --worker codex_direct \
  --mode repair \
  --max-turns 40 \
  --max-tool-calls 100 \
  --max-failed-tool-calls 8 \
  --denied ".git/**" \
  --denied ".runstead/**" \
  --verifier "test=npm test" \
  --verifier "lint=npm run lint" \
  "Repair the failing contract with the smallest safe change."
```

## Governance Levels

### Level 1: Wrapped Worker

Used by `codex_cli` and `claude_code`.

Runstead can:

- approve or deny worker launch
- checkpoint the workspace
- constrain paths and dependency policy around the run
- run verifiers after the worker exits
- record command output, reports, and audit state

Runstead cannot hard-proxy every internal tool call made by the external worker.

### Level 2: Native Proxy

Used by `codex_direct`.

Runstead can govern exposed model tool calls before execution:

- `filesystem.read`
- `filesystem.write`
- `filesystem.patch`
- `shell.exec`
- `git.status`, `git.diff`, `git.log`, `git.show`
- `verifier.run`
- `evidence.read`
- `workspace.facts.read`

This is stronger but requires cleaner policy setup and more careful prompts.

## Practical Caveats From Dogfood

`codex_direct` is valuable but should not be the default path until its local
editing UX is smoother.

Observed caveats:

- first-time workspace writes may require explicit approval
- repeated `agent resume` calls can enter a new model turn and produce a new
  write action
- broad prompts can exhaust the direct-worker turn budget
- narrow repair prompts work better than "build the whole app" prompts
- local edit-heavy work needs an explicit policy that allows ordinary source
  edits while keeping protected paths, dependencies, and external writes guarded

Recommended `codex_direct` operating style:

- use narrow prompts
- increase `--max-turns` and `--max-tool-calls` for repair work
- deny `.git/**` and `.runstead/**`
- keep `.env`, secrets, production infra, dependency changes, pushes, and PRs
  approval-gated
- require verifiers on every edit or repair task

## Product Positioning

Runstead should present:

- `codex_cli` as the **recommended default founder workflow**
- `codex_direct` as the **strict governed workflow**

That gives users a fast path for MVP readiness and an upgrade path for
high-assurance work.
