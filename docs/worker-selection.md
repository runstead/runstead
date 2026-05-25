# Worker Selection

Runstead can run external coding agents as wrapped workers or run a native
Codex loop through `codex_direct`. The right default depends on the risk
profile of the task.

## Default Recommendation

Use **`codex_direct` with `--governance governed`** for governance-sensitive
work, and **`codex_cli`** as a fast path when post-run evidence is enough.

`runstead startup ready` exposes both with a single `--governance` flag:

- `--governance readiness` allows Level 1 wrapped workers (`codex_cli`,
  `claude_code`) and gives a fast product-readiness loop with checkpoints,
  verifier evidence, reports, gates, and audit around the external worker.
- `--governance governed` requires `codex_direct` and fails closed for
  wrapped workers.
- `--governance auto` (default) keeps local and staging readiness on
  `codex_cli` but selects `codex_direct` for production targets unless
  `--worker` overrides.

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
runstead startup ready \
  --cwd /path/to/mvp \
  --worker codex_cli \
  --target local
```

## When To Use `codex_direct`

Choose `codex_direct` when:

- every exposed model tool call must be governed by Runstead policy
- model-exposed filesystem, shell, git-read, verifier, and evidence-read
  actions need hard-proxy audit
- the repo has strict protected paths or approval boundaries
- the team needs evidence that the model could not bypass Runstead's tool
  layer
- the task is compliance-sensitive, security-sensitive, or
  production-adjacent

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

For scaffold-heavy work, prefer `runstead startup ready --worker codex_direct
--governance governed --app-template static-todo --app-type local-first-web`.
That path scopes scaffold patch approvals to the task's app-owned files and
reuses one approval grant across many file writes, while still requiring
explicit approval for dependency files and protected state.

## Governance Levels

### Level 1: Wrapped Worker

Used by `codex_cli` and `claude_code`.

Runstead can:

- approve or deny worker launch
- checkpoint the workspace
- constrain paths and dependency policy around the run
- run verifiers after the worker exits
- record command output, reports, and audit state

Runstead cannot hard-proxy every internal tool call made by the external
worker. The worker's own sandbox or permission flags are the inner boundary.

### Level 2: Native Proxy

Used by `codex_direct`.

Runstead governs every exposed model tool call before execution:

- filesystem read, list, search, stat, write, patch
- shell command execution
- git status, diff, log, show, and diff-summary reads
- verifier runs
- evidence reads; verifier and command execution record evidence through
  Runstead-owned runtime paths
- workspace facts reads

Model calls themselves are governed through `model.inference.request` with
recorded `network_write_external` and `llm_data_egress` side effects.
Per-request heartbeats, bounded transient-error retries with jitter, and
timeout aborts protect long runs from hanging on provider issues.

`runstead startup ready --plan` and completed readiness summaries print this
boundary explicitly so launch reports do not overstate what a selected worker
can prove.

## Practical Operating Style

For `codex_direct`:

- use narrow prompts; broad "build the whole product" prompts exhaust the
  turn budget
- increase `--max-turns` and `--max-tool-calls` for repair work
- deny `.git/**` and `.runstead/**`
- keep `.env`, secrets, production infra, dependency changes, pushes, and
  PRs approval-gated
- require verifiers on every edit or repair task
- prefer `approve-and-resume` over separate `approve` then `agent resume`

For empty-repo scaffolds, declare `--app-template` so the scaffold profile
classifies safe app-owned writes and the first approval covers the whole
scaffold pass.

## Product Positioning

- `codex_cli` is the **fast Level 1 path** for local MVP work where post-run
  evidence is enough.
- `codex_direct` is the **strict Level 2 path** when every exposed tool call
  must be audited.

That gives users a fast path for MVP readiness and an upgrade path for
high-assurance work. See [security-model.md](security-model.md) for the
formal trust boundary and non-goals.
